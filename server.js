const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = {};

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
             setTimeout(() => {
                 io.to(roomId).emit("move_to_setup");
             }, 1000);
        }
    };

    socket.on("create_room", ({ name }) => {
        const roomId = generateRoomId();
        rooms[roomId] = { players: {}, turn: null, started: false };

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
                io.to(id).emit("game_ready", {
                    roomId,
                    opponent: opponent.name,
                    turn: room.turn
                });
            });
        }
    });

    socket.on("make_guess", ({ roomId, guess }) => {
        const room = rooms[roomId];
        if (!room || !room.started || room.turn !== socket.id) return;
        if (!validCode(guess)) return;

        const opponentId = Object.keys(room.players).find(id => id !== socket.id);
        const { bulls, cows } = getScore(room.players[opponentId].secret, guess);
        const winner = bulls === 4;

        if (!winner) room.turn = opponentId;

        io.to(roomId).emit("guess_result", {
            player: socket.id,
            guess,
            bulls,
            cows,
            winner,
            nextTurn: room.turn
        });
    });

    // --- NEW: Chat Listener ---
    socket.on("send_chat", ({ roomId, message, senderName }) => {
        io.to(roomId).emit("receive_chat", { message, senderName, senderId: socket.id });
    });

    socket.on("disconnect", () => {
        for (const id in rooms) {
            if (rooms[id].players[socket.id]) {
                delete rooms[id];
                break;
            }
        }
    });
});

server.listen(3000, () => console.log("Server running on port 3000"));