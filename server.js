const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = {};
const disconnectTimers = {};

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// --- HELPER FUNCTIONS ---
function generateRoomId() {
    let id;
    do {
        id = Math.floor(1000 + Math.random() * 9000).toString();
    } while (rooms[id]);
    return id;
}

const validCode = s => /^\d{4}$/.test(s) && new Set(s).size === 4;

function getScore(secret, guess) {
    let bulls = 0, cows = 0;
    const s = secret.split("");
    const g = guess.split("");
    for (let i = 0; i < 4; i++) {
        if (s[i] === g[i]) {
            bulls++;
            s[i] = g[i] = null;
        }
    }
    for (let i = 0; i < 4; i++) {
        if (g[i] && s.includes(g[i])) {
            cows++;
            s[s.indexOf(g[i])] = null;
        }
    }
    return { bulls, cows };
}

io.on("connection", socket => {

    const broadcastLobby = (roomId) => {
        const room = rooms[roomId];
        if (!room) return;
        const players = Object.values(room.players).map(p => ({ name: p.name, id: p.id }));
        io.to(roomId).emit("lobby_update", { roomId, players });
        if (players.length === 2) {
            setTimeout(() => io.to(roomId).emit("move_to_setup"), 1000);
        }
    };

    socket.on("create_room", ({ name }) => {
        const roomId = generateRoomId();
        rooms[roomId] = { players: {}, turn: null, started: false, guesses: [], chatHistory: [] };
        socket.join(roomId);
        rooms[roomId].players[socket.id] = { name, secret: null, id: socket.id };
        socket.emit("room_created", { roomId });
        broadcastLobby(roomId);
    });

    socket.on("join_room", ({ roomId, name }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit("error_msg", "Room not found");
        if (Object.keys(room.players).length >= 2) return socket.emit("error_msg", "Room full");
        socket.join(roomId);
        room.players[socket.id] = { name, secret: null, id: socket.id };
        socket.emit("joined_success", { roomId });
        broadcastLobby(roomId);
    });

    socket.on("rejoin_room", ({ roomId, name }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit("error_msg", "Room expired.");
        
        const playerEntry = Object.entries(room.players).find(([id, p]) => p.name === name);
        if (playerEntry) {
            const [oldSocketId, playerData] = playerEntry;
            
            if (disconnectTimers[oldSocketId]) {
                clearInterval(disconnectTimers[oldSocketId]);
                delete disconnectTimers[oldSocketId];
            }

            if (room.turn === oldSocketId) {
                room.turn = socket.id;
            }

            room.players[socket.id] = playerData;
            room.players[socket.id].id = socket.id;
            if (oldSocketId !== socket.id) delete room.players[oldSocketId];

            socket.join(roomId);
            const opponent = Object.values(room.players).find(p => p.name !== name);
            
            socket.emit("rejoined_game", {
                roomId, name, secret: playerData.secret,
                opponentName: opponent ? opponent.name : "Waiting...",
                turn: room.turn, started: room.started,
                guesses: room.guesses, chatHistory: room.chatHistory
            });
            io.to(roomId).emit("reconnect_success", `${name} reconnected!`);
        } else {
            socket.emit("error_msg", "Session not found.");
        }
    });

    socket.on("set_secret", ({ roomId, secret }) => {
        const room = rooms[roomId];
        if (!room || !validCode(secret)) return;
        room.players[socket.id].secret = secret;
        const players = Object.entries(room.players);
        
        if (players.length === 2 && players.every(([_, p]) => p.secret)) {
            room.started = true;
            room.turn = players[0][0]; 
            players.forEach(([id]) => {
                const opponent = players.find(([oid]) => oid !== id)[1];
                io.to(id).emit("game_ready", { roomId, opponent: opponent.name, turn: room.turn });
            });
        }
    });

    socket.on("make_guess", ({ roomId, guess }) => {
        const room = rooms[roomId];
        if (!room || !room.started || room.turn !== socket.id) return;
        
        const opponentId = Object.keys(room.players).find(id => id !== socket.id);
        const { bulls, cows } = getScore(room.players[opponentId].secret, guess);
        const winner = bulls === 4;
        
        const result = { player: socket.id, playerName: room.players[socket.id].name, guess, bulls, cows, winner, nextTurn: winner ? socket.id : opponentId };
        
        if (!winner) room.turn = opponentId;
        
        room.guesses.push(result);
        io.to(roomId).emit("guess_result", result);
    });

    socket.on("send_chat", ({ roomId, message, senderName }) => {
        const chatData = { message, senderName, senderId: socket.id };
        if(rooms[roomId]) {
            rooms[roomId].chatHistory.push(chatData);
            io.to(roomId).emit("receive_chat", chatData);
        }
    });

    socket.on("typing", ({ roomId, isTyping, name }) => {
        socket.broadcast.to(roomId).emit("display_typing", { isTyping, name });
    });

    socket.on("play_again", ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        room.started = false;
        room.guesses = [];
        room.turn = null;
        Object.values(room.players).forEach(p => p.secret = null);
        io.to(roomId).emit("reset_for_rematch");
    });

    socket.on("leave_room", ({ roomId }) => {
        if(rooms[roomId]) delete rooms[roomId];
        socket.leave(roomId);
        socket.emit("room_exited");
    });

    socket.on("disconnect", () => {
        for (const roomId in rooms) {
            if (rooms[roomId].players[socket.id]) {
                const room = rooms[roomId];
                const playerName = room.players[socket.id].name;
                let timeLeft = 60; 

                io.to(roomId).emit("opponent_disconnected", { name: playerName, timeLeft });

                const timerId = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0) {
                        io.to(roomId).emit("timer_tick", { timeLeft });
                    } else {
                        clearInterval(timerId);
                        if (rooms[roomId]) delete rooms[roomId];
                        io.to(roomId).emit("error_msg", "Opponent left. Room closed.");
                    }
                }, 1000);
                
                disconnectTimers[socket.id] = timerId;
                break;
            }
        }
    });
});

server.listen(3000, '0.0.0.0', () => console.log("Server running on port 3000"));