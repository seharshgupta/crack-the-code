const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const rooms = {};
const disconnectIntervals = {};

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

function generateRoomId() {
    let id; do { id = Math.floor(1000 + Math.random() * 9000).toString(); } while (rooms[id]);
    return id;
}
function getScore(secret, guess) {
    let bulls = 0, cows = 0;
    const s = secret.split(""), g = guess.split("");
    for (let i = 0; i < 4; i++) { if (s[i] === g[i]) { bulls++; s[i] = g[i] = null; } }
    for (let i = 0; i < 4; i++) { if (g[i] && s.includes(g[i])) { cows++; s[s.indexOf(g[i])] = null; } }
    return { bulls, cows };
}

io.on("connection", socket => {

    socket.on("create_room", ({ name, token }) => {
        const roomId = generateRoomId();
        rooms[roomId] = {
            players: {}, gameState: 'lobby', roundCount: 0,
            guesses: [], chatHistory: [], playerOrder: [],
            pendingRequests: {}, stats: { wins: {}, history: [] }, rematchRequests: new Set()
        };
        socket.join(roomId);
        rooms[roomId].players[token] = { name, secret: null, ready: false, socketId: socket.id, token };
        rooms[roomId].playerOrder.push(token);
        rooms[roomId].stats.wins[name] = 0;
        socket.emit("room_created", { roomId });
    });

    socket.on("get_lobbies", () => {
        const list = Object.keys(rooms)
            .filter(id => rooms[id].gameState === 'lobby' && Object.keys(rooms[id].players).length < 2)
            .map(id => ({ id, host: rooms[id].players[rooms[id].playerOrder[0]].name }));
        socket.emit("lobby_list", list);
    });

    socket.on("request_join", ({ roomId, token, name }) => {
        const room = rooms[roomId];
        if (!room) return socket.emit("error_msg", "Room not found");
        if (Object.keys(room.players).length >= 2) return socket.emit("error_msg", "Room full");
        room.pendingRequests[token] = { name, socketId: socket.id };
        const hostToken = room.playerOrder[0];
        io.to(room.players[hostToken].socketId).emit("join_request_received", { suitorName: name, suitorToken: token });
    });

    socket.on("cancel_join_request", ({ roomId, token }) => {
        const room = rooms[roomId];
        if (room && room.pendingRequests[token]) delete room.pendingRequests[token];
    });

    socket.on("handle_request", ({ roomId, suitorToken, accepted }) => {
        const room = rooms[roomId];
        if (!room || !room.pendingRequests[suitorToken]) return;
        const suitor = room.pendingRequests[suitorToken];
        if (accepted) {
            room.players[suitorToken] = { name: suitor.name, secret: null, ready: false, socketId: suitor.socketId, token: suitorToken };
            room.playerOrder.push(suitorToken);
            room.stats.wins[suitor.name] = 0;
            const suitorSocket = io.sockets.sockets.get(suitor.socketId);
            if (suitorSocket) suitorSocket.join(roomId);
            io.to(suitor.socketId).emit("join_approved", { roomId });
            socket.emit("player_accepted", { name: suitor.name });
        } else {
            io.to(suitor.socketId).emit("join_rejected");
        }
        delete room.pendingRequests[suitorToken];
    });

    socket.on("get_leaderboard", ({ roomId }) => {
        const room = rooms[roomId];
        if (room) socket.emit("leaderboard_data", room.stats);
    });

    socket.on("host_start_setup", ({ roomId }) => {
        const room = rooms[roomId];
        if (!room) return;
        room.gameState = 'setup';
        io.to(roomId).emit("enter_setup");
    });

    socket.on("player_ready", ({ roomId, token, secret }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'setup') return;
        const player = room.players[token];
        if (player) {
            player.secret = secret;
            player.ready = true;
            socket.broadcast.to(roomId).emit("op_ready_state");
            if (Object.values(room.players).every(p => p.ready && p.secret)) {
                room.gameState = 'game';
                const starterIndex = room.roundCount % 2;
                room.turnToken = room.playerOrder[starterIndex];
                const p1 = room.players[room.playerOrder[0]];
                const p2 = room.players[room.playerOrder[1]];
                io.to(p1.socketId).emit("game_start", { opponent: p2.name, turnToken: room.turnToken });
                io.to(p2.socketId).emit("game_start", { opponent: p1.name, turnToken: room.turnToken });
            }
        }
    });

    socket.on("make_guess", ({ roomId, token, guess }) => {
        const room = rooms[roomId];
        if (!room || room.gameState !== 'game' || room.turnToken !== token) return;
        const opponentToken = room.playerOrder.find(t => t !== token);
        const opponent = room.players[opponentToken];
        const { bulls, cows } = getScore(opponent.secret, guess);
        const winner = bulls === 4;
        const nextTurnToken = winner ? token : opponentToken;
        if (!winner) room.turnToken = nextTurnToken;

        const result = { playerToken: token, playerName: room.players[token].name, guess, bulls, cows, winner, turnToken: room.turnToken };
        if (winner) {
            room.stats.wins[room.players[token].name]++;
            const myGuesses = room.guesses.filter(g => g.playerToken === token).length + 1;
            room.stats.history.push({ winner: room.players[token].name, secret: opponent.secret, guesses: myGuesses });

            // FIX: Send BOTH secrets securely mapped
            result.secrets = {};
            Object.values(room.players).forEach(p => result.secrets[p.token] = p.secret);
        }
        room.guesses.push(result);
        io.to(roomId).emit("guess_result", result);
    });

    socket.on("play_again", ({ roomId, token }) => {
        const room = rooms[roomId];
        if (!room) return;
        room.rematchRequests.add(token);
        io.to(roomId).emit("rematch_status_update", { requestCount: room.rematchRequests.size, whoRequested: room.players[token].name });
        if (room.rematchRequests.size === 2) {
            room.gameState = 'setup';
            room.guesses = [];
            room.turnToken = null;
            room.roundCount++;
            room.rematchRequests.clear();
            Object.values(room.players).forEach(p => { p.secret = null; p.ready = false; });
            io.to(roomId).emit("enter_setup");
        }
    });

    socket.on("send_chat", ({ roomId, message, token }) => {
        if (rooms[roomId] && rooms[roomId].players[token]) {
            const msgData = { message, senderName: rooms[roomId].players[token].name, playerToken: token };
            rooms[roomId].chatHistory.push(msgData);
            io.to(roomId).emit("receive_chat", msgData);
        }
    });

    socket.on("typing", ({ roomId, token, isTyping }) => {
        if (rooms[roomId] && rooms[roomId].players[token]) socket.broadcast.to(roomId).emit("display_typing", { isTyping, name: rooms[roomId].players[token].name });
    });

    socket.on("rejoin_room", ({ roomId, token }) => {
        const room = rooms[roomId];
        if (!room || !room.players[token]) return socket.emit("error_msg", "Room expired.");
        const player = room.players[token];
        player.socketId = socket.id;
        socket.join(roomId);
        if (disconnectIntervals[token]) { clearInterval(disconnectIntervals[token]); delete disconnectIntervals[token]; }
        const opponentToken = room.playerOrder.find(t => t !== token);
        const opponent = room.players[opponentToken];
        socket.emit("rejoined_game", {
            roomId, name: player.name, secret: player.secret,
            state: room.gameState,
            opponentName: opponent ? opponent.name : "Waiting...",
            turnToken: room.turnToken,
            guesses: room.guesses,
            chatHistory: room.chatHistory,
            rematchPending: room.rematchRequests.has(token)
        });
        if (room.gameState === 'setup' && opponent && opponent.ready) socket.emit("op_ready_state");
        io.to(roomId).emit("reconnect_success");
    });

    socket.on("leave_room", ({ roomId, token }) => {
        const room = rooms[roomId];
        if (room) {
            delete room.players[token];
            socket.leave(roomId);
            if (Object.keys(room.players).length === 0) delete rooms[roomId];
            else { io.to(roomId).emit("error_msg", "Opponent left the lobby."); delete rooms[roomId]; }
        }
    });

    socket.on("disconnect", () => {
        for (const roomId in rooms) {
            const room = rooms[roomId];
            const token = Object.keys(room.players).find(t => room.players[t].socketId === socket.id);
            if (token) {
                const player = room.players[token];
                let timeLeft = 60;
                io.to(roomId).emit("opponent_disconnected", { name: player.name, timeLeft });
                const intervalId = setInterval(() => {
                    timeLeft--;
                    if (timeLeft > 0) io.to(roomId).emit("timer_tick", { timeLeft });
                    else {
                        clearInterval(intervalId);
                        if (disconnectIntervals[token]) delete disconnectIntervals[token];
                        io.to(roomId).emit("error_msg", "Opponent did not reconnect. Room closed.");
                        delete rooms[roomId];
                    }
                }, 1000);
                disconnectIntervals[token] = intervalId;
                break;
            }
        }
    });
});

server.listen(3000, '0.0.0.0', () => console.log("Server running on port 3000"));