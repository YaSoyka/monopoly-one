const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// CORS настройки для Render
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

// Глобальные переменные
let onlineUsers = 0;
const connectedSockets = new Map();
const activeGames = new Map();

// Middleware
app.use(cors());
app.use(express.json());

// Статические файлы - важно для Render
app.use(express.static(path.join(__dirname, '../public')));

// Логирование для отладки
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
});

// MongoDB Connection с обработкой ошибок
const connectDB = async () => {
    try {
        const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/monopoly_one';
        console.log('Connecting to MongoDB...');
        await mongoose.connect(mongoURI, {
            useNewUrlParser: true,
            useUnifiedTopology: true
        });
        console.log('MongoDB Connected successfully');
    } catch (err) {
        console.error('MongoDB Connection Error:', err.message);
        // Не выходим, чтобы сервер мог работать без БД в режиме разработки
    }
};

connectDB();

// Модели
const UserSchema = new mongoose.Schema({
    nick: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    avatar: { type: String, default: '/default-avatar.png' },
    level: { type: Number, default: 1 },
    xp: { type: Number, default: 0 },
    vip: { type: Boolean, default: true },
    wins: { type: Number, default: 0 },
    games: { type: Number, default: 0 },
    online: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    friendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    inventory: [{
        itemId: String,
        name: String,
        image: String,
        type: String,
        equipped: Boolean
    }],
    createdAt: { type: Date, default: Date.now }
});

const GameSchema = new mongoose.Schema({
    roomId: { type: String, unique: true, index: true },
    name: { type: String, default: '' },
    host: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    mode: { type: String, enum: ['classic', 'fast'], default: 'classic' },
    maxPlayers: { type: Number, default: 6 },
    isPrivate: { type: Boolean, default: false },
    autoStart: { type: Boolean, default: true },
    players: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        position: { type: Number, default: 0 },
        money: { type: Number, default: 1500 },
        properties: [{ type: Number }],
        inJail: { type: Boolean, default: false },
        jailTurns: { type: Number, default: 0 },
        isReady: { type: Boolean, default: false },
        isActive: { type: Boolean, default: true }
    }],
    status: { type: String, enum: ['waiting', 'playing', 'finished', 'closed'], default: 'waiting' },
    currentTurn: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    endedAt: { type: Date }
});

const MessageSchema = new mongoose.Schema({
    roomId: { type: String, default: 'global', index: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    nick: String,
    avatar: String,
    text: String,
    system: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Game = mongoose.model('Game', GameSchema);
const Message = mongoose.model('Message', MessageSchema);

// JWT Middleware
const authMiddleware = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'No token' });
    
    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
        req.userId = decoded.userId;
        next();
    } catch (err) {
        res.status(401).json({ error: 'Invalid token' });
    }
};

// Health check для Render
app.get('/health', (req, res) => {
    res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Роуты аутентификации
app.post('/api/auth/register', async (req, res) => {
    try {
        console.log('Register attempt:', req.body.email);
        const { nick, email, password } = req.body;
        
        if (!nick || !email || !password) {
            return res.status(400).json({ error: 'All fields required' });
        }
        
        const existingUser = await User.findOne({ $or: [{ nick }, { email }] });
        if (existingUser) {
            return res.status(400).json({ error: 'User already exists' });
        }
        
        const hashedPassword = await bcrypt.hash(password, 10);
        
        const starterInventory = [
            { itemId: 'case_1', name: 'Коробочка с кубиками #6', image: '/items/dice-box.png', type: 'case', equipped: false },
            { itemId: 'brand_klm', name: 'KLM', image: '/items/klm.png', type: 'brand', equipped: true },
            { itemId: 'brand_samsung', name: 'Samsung', image: '/items/samsung.png', type: 'brand', equipped: true }
        ];
        
        const user = new User({
            nick,
            email,
            password: hashedPassword,
            avatar: `https://api.dicebear.com/7.x/avataaars/svg?seed=${nick}`,
            inventory: starterInventory,
            vip: true
        });
        
        await user.save();
        console.log('User created:', nick);
        
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret');
        res.json({ token, user: { id: user._id, nick, email, avatar: user.avatar, vip: true, level: 1 } });
    } catch (err) {
        console.error('Register error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        console.log('Login attempt:', req.body.email);
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password required' });
        }
        
        const user = await User.findOne({ email });
        
        if (!user || !await bcrypt.compare(password, user.password)) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }
        
        await User.findByIdAndUpdate(user._id, { online: true, lastSeen: new Date() });
        
        const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET || 'secret');
        res.json({ 
            token, 
            user: { 
                id: user._id, 
                nick: user.nick, 
                email: user.email, 
                avatar: user.avatar,
                vip: user.vip,
                level: user.level,
                wins: user.wins,
                games: user.games
            } 
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/user/me', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.userId).populate('friends', 'nick avatar online');
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/user/profile', authMiddleware, async (req, res) => {
    try {
        const { nick, avatar } = req.body;
        const updates = {};
        if (nick) updates.nick = nick;
        if (avatar) updates.avatar = avatar;
        
        const user = await User.findByIdAndUpdate(req.userId, updates, { new: true });
        res.json(user);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Поиск пользователей
app.get('/api/users/search', async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) {
            return res.json({ users: [] });
        }
        
        const users = await User.find({
            nick: { $regex: q, $options: 'i' }
        })
        .select('nick avatar level _id')
        .limit(10);
        
        res.json({ users });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/friends', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.userId).populate('friends', 'nick avatar level wins online lastSeen');
        res.json(user.friends);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/friends/add/:userId', authMiddleware, async (req, res) => {
    try {
        const targetUser = await User.findById(req.params.userId);
        if (!targetUser) return res.status(404).json({ error: 'User not found' });
        
        if (targetUser._id.toString() === req.userId) {
            return res.status(400).json({ error: 'Cannot add yourself' });
        }
        
        if (!targetUser.friendRequests.includes(req.userId)) {
            targetUser.friendRequests.push(req.userId);
            await targetUser.save();
        }
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/friends/accept/:userId', authMiddleware, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.userId, { 
            $pull: { friendRequests: req.params.userId },
            $addToSet: { friends: req.params.userId }
        });
        await User.findByIdAndUpdate(req.params.userId, { 
            $addToSet: { friends: req.userId }
        });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/friends/:userId', authMiddleware, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.userId, { $pull: { friends: req.params.userId } });
        await User.findByIdAndUpdate(req.params.userId, { $pull: { friends: req.userId } });
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/inventory', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        res.json(user.inventory);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/inventory/equip/:itemId', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        const item = user.inventory.find(i => i.itemId === req.params.itemId);
        if (item) {
            item.equipped = !item.equipped;
            await user.save();
        }
        res.json(user.inventory);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Игровые роуты
app.get('/api/games', async (req, res) => {
    try {
        const games = await Game.find({ status: 'waiting', isPrivate: false })
            .populate('host', 'nick avatar')
            .populate('players.user', 'nick avatar')
            .sort({ createdAt: -1 })
            .limit(20);
        res.json(games);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/games/create', authMiddleware, async (req, res) => {
    try {
        const { mode = 'classic', maxPlayers = 6, isPrivate = false, autoStart = true } = req.body;
        
        const roomId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        
        const game = new Game({
            roomId,
            host: req.userId,
            mode,
            maxPlayers: Math.min(Math.max(maxPlayers, 2), 6),
            isPrivate,
            autoStart,
            players: [{
                user: req.userId,
                position: 0,
                money: 1500,
                properties: [],
                inJail: false,
                jailTurns: 0,
                isReady: false,
                isActive: true
            }],
            status: 'waiting'
        });
        
        await game.save();
        
        activeGames.set(roomId, {
            gameId: game._id,
            host: req.userId,
            players: [req.userId],
            status: 'waiting',
            createdAt: new Date()
        });
        
        res.json({ roomId, game });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/games/join/:roomId', authMiddleware, async (req, res) => {
    try {
        const game = await Game.findOne({ roomId: req.params.roomId });
        
        if (!game) return res.status(404).json({ error: 'Game not found' });
        if (game.status !== 'waiting') return res.status(400).json({ error: 'Game already started' });
        if (game.players.length >= game.maxPlayers) return res.status(400).json({ error: 'Room full' });
        
        const existingPlayer = game.players.find(p => p.user.toString() === req.userId);
        if (existingPlayer) {
            return res.json({ game });
        }
        
        game.players.push({
            user: req.userId,
            position: 0,
            money: 1500,
            properties: [],
            inJail: false,
            jailTurns: 0,
            isReady: false,
            isActive: true
        });
        
        await game.save();
        
        const activeGame = activeGames.get(req.params.roomId);
        if (activeGame) {
            activeGame.players.push(req.userId);
        }
        
        io.to(req.params.roomId).emit('playerJoined', { userId: req.userId });
        
        res.json({ game });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/games/:roomId', async (req, res) => {
    try {
        const game = await Game.findOne({ roomId: req.params.roomId })
            .populate('host', 'nick avatar')
            .populate('players.user', 'nick avatar');
        if (!game) return res.status(404).json({ error: 'Game not found' });
        res.json(game);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/games/:roomId/end', authMiddleware, async (req, res) => {
    try {
        const game = await Game.findOne({ roomId: req.params.roomId });
        if (!game) return res.status(404).json({ error: 'Game not found' });
        
        if (game.host.toString() !== req.userId) {
            return res.status(403).json({ error: 'Only host can end game' });
        }
        
        game.status = 'finished';
        game.endedAt = new Date();
        await game.save();
        
        io.to(req.params.roomId).emit('gameEnded', { roomId: req.params.roomId });
        
        setTimeout(async () => {
            await Game.deleteOne({ roomId: req.params.roomId });
            activeGames.delete(req.params.roomId);
            io.to(req.params.roomId).emit('roomClosed');
        }, 5 * 60 * 1000);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/games/:roomId/leave', authMiddleware, async (req, res) => {
    try {
        const game = await Game.findOne({ roomId: req.params.roomId });
        if (!game) return res.status(404).json({ error: 'Game not found' });
        
        const playerIndex = game.players.findIndex(p => p.user.toString() === req.userId);
        if (playerIndex === -1) return res.status(400).json({ error: 'Not in game' });
        
        game.players[playerIndex].isActive = false;
        
        if (game.host.toString() === req.userId) {
            const nextHost = game.players.find(p => p.isActive && p.user.toString() !== req.userId);
            if (nextHost) {
                game.host = nextHost.user;
            }
        }
        
        const activePlayers = game.players.filter(p => p.isActive);
        if (activePlayers.length <= 1 && game.status === 'waiting') {
            await Game.deleteOne({ roomId: req.params.roomId });
            activeGames.delete(req.params.roomId);
            io.to(req.params.roomId).emit('roomClosed');
            return res.json({ success: true, roomClosed: true });
        }
        
        await game.save();
        io.to(req.params.roomId).emit('playerLeft', { userId: req.userId });
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/chat/history', async (req, res) => {
    try {
        const messages = await Message.find({ roomId: 'global' })
            .populate('user', 'nick avatar')
            .sort({ createdAt: -1 })
            .limit(50);
        res.json(messages.reverse());
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Socket.io
io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    
    onlineUsers++;
    io.emit('onlineCount', onlineUsers);
    socket.emit('onlineCount', onlineUsers);
    
    socket.on('authenticate', async (token) => {
        try {
            if (token && token !== 'guest') {
                const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
                socket.userId = decoded.userId;
                connectedSockets.set(socket.id, { userId: decoded.userId, socket });
                
                await User.findByIdAndUpdate(decoded.userId, { online: true, lastSeen: new Date() });
                
                const user = await User.findById(decoded.userId);
                if (user) {
                    socket.broadcast.emit('userOnline', { userId: decoded.userId, nick: user.nick });
                }
            }
        } catch (err) {
            console.log('Auth error:', err.message);
        }
    });
    
    socket.on('joinRoom', async ({ roomId, token }) => {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET || 'secret');
            const game = await Game.findOne({ roomId }).populate('players.user');
            
            if (!game) {
                socket.emit('error', { message: 'Game not found' });
                return;
            }
            
            socket.join(roomId);
            socket.userId = decoded.userId;
            socket.roomId = roomId;
            
            socket.emit('gameState', game);
            socket.to(roomId).emit('playerConnected', { userId: decoded.userId });
            
        } catch (err) {
            socket.emit('error', { message: 'Invalid token' });
        }
    });
    
    socket.on('chatMessage', async ({ text, roomId }) => {
        try {
            let userData = { nick: 'Гость', avatar: '/default-avatar.png', color: '#888' };
            
            if (socket.handshake.auth.token && socket.handshake.auth.token !== 'guest') {
                const decoded = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET || 'secret');
                const user = await User.findById(decoded.userId);
                if (user) {
                    userData = { 
                        nick: user.nick, 
                        avatar: user.avatar,
                        color: user.vip ? '#FFD700' : '#22c55e'
                    };
                    
                    await Message.create({
                        roomId: roomId || 'global',
                        user: decoded.userId,
                        nick: user.nick,
                        avatar: user.avatar,
                        text
                    });
                }
            }
            
            const message = {
                user: userData.nick,
                avatar: userData.avatar,
                text,
                time: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
                system: false,
                color: userData.color
            };
            
            if (roomId && roomId !== 'global') {
                io.to(roomId).emit('newMessage', message);
            } else {
                io.emit('newMessage', message);
            }
        } catch (err) {
            console.error('Chat error:', err);
        }
    });
    
    socket.on('rollDice', async () => {
        const { roomId, userId } = socket;
        if (!roomId || !userId) return;
        
        const dice1 = Math.floor(Math.random() * 6) + 1;
        const dice2 = Math.floor(Math.random() * 6) + 1;
        const total = dice1 + dice2;
        const isDouble = dice1 === dice2;
        
        try {
            const game = await Game.findOne({ roomId });
            const player = game.players.find(p => p.user.toString() === userId);
            
            if (player && player.isActive) {
                if (player.inJail) {
                    if (isDouble) {
                        player.inJail = false;
                        player.jailTurns = 0;
                    } else {
                        player.jailTurns++;
                        if (player.jailTurns >= 3) {
                            player.inJail = false;
                            player.jailTurns = 0;
                            player.money -= 50;
                        }
                    }
                }
                
                if (!player.inJail) {
                    player.position = (player.position + total) % 40;
                    if (player.position < total) {
                        player.money += 200;
                    }
                }
                
                await game.save();
                
                io.to(roomId).emit('diceRolled', {
                    userId,
                    dice: [dice1, dice2],
                    total,
                    isDouble,
                    newPosition: player.position,
                    money: player.money,
                    inJail: player.inJail
                });
                
                if (!isDouble || player.inJail) {
                    game.currentTurn = (game.currentTurn + 1) % game.players.length;
                    while (!game.players[game.currentTurn]?.isActive) {
                        game.currentTurn = (game.currentTurn + 1) % game.players.length;
                    }
                    await game.save();
                    io.to(roomId).emit('nextTurn', { currentTurn: game.currentTurn });
                }
            }
        } catch (err) {
            console.error('Roll dice error:', err);
        }
    });
    
    socket.on('playerReady', async ({ roomId, isReady }) => {
        try {
            const game = await Game.findOne({ roomId });
            const player = game.players.find(p => p.user.toString() === socket.userId);
            if (player) {
                player.isReady = isReady;
                await game.save();
                io.to(roomId).emit('playerReady', { userId: socket.userId, isReady });
                
                const allReady = game.players.every(p => p.isReady || !p.isActive);
                if (allReady && game.players.filter(p => p.isActive).length >= 2 && game.autoStart) {
                    game.status = 'playing';
                    await game.save();
                    io.to(roomId).emit('gameStarted', { game });
                }
            }
        } catch (err) {
            console.error(err);
        }
    });
    
    socket.on('buyProperty', async ({ roomId, position }) => {
        try {
            const game = await Game.findOne({ roomId });
            const player = game.players.find(p => p.user.toString() === socket.userId);
            
            if (player && !player.properties.includes(position)) {
                const price = getPropertyPrice(position);
                if (player.money >= price) {
                    player.money -= price;
                    player.properties.push(position);
                    await game.save();
                    io.to(roomId).emit('propertyBought', { userId: socket.userId, position, price });
                }
            }
        } catch (err) {
            console.error(err);
        }
    });
    
    socket.on('disconnect', async () => {
        console.log('User disconnected:', socket.id);
        
        onlineUsers--;
        io.emit('onlineCount', onlineUsers);
        
        if (socket.userId) {
            await User.findByIdAndUpdate(socket.userId, { 
                online: false, 
                lastSeen: new Date() 
            });
            
            connectedSockets.delete(socket.id);
            socket.broadcast.emit('userOffline', { userId: socket.userId });
        }
        
        if (socket.roomId) {
            socket.to(socket.roomId).emit('playerDisconnected', { userId: socket.userId });
        }
    });
});

function getPropertyPrice(pos) {
    const prices = {
        1: 60, 3: 60,
        6: 100, 8: 100, 9: 120,
        11: 140, 13: 140, 14: 160,
        16: 180, 18: 180, 19: 200,
        21: 220, 23: 220, 24: 240,
        26: 260, 27: 260, 29: 280,
        31: 300, 32: 300, 34: 320,
        37: 350, 39: 400
    };
    return prices[pos] || 0;
}

// Очистка старых игр каждые 30 минут
setInterval(async () => {
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    await Game.deleteMany({ 
        status: 'waiting', 
        createdAt: { $lt: thirtyMinutesAgo } 
    });
    console.log('Cleaned up old waiting games');
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`MongoDB: ${process.env.MONGODB_URI ? 'Connected' : 'Local'}`);
});
