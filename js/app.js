// Common utilities and shared functionality

const API_BASE = '';

// Auth utilities
const Auth = {
    getToken() {
        return localStorage.getItem('token');
    },
    
    setToken(token) {
        localStorage.setItem('token', token);
    },
    
    removeToken() {
        localStorage.removeItem('token');
    },
    
    isAuthenticated() {
        return !!this.getToken();
    },
    
    async getUser() {
        try {
            const res = await fetch('/api/user/me', {
                headers: { 'Authorization': 'Bearer ' + this.getToken() }
            });
            if (res.ok) return await res.json();
            return null;
        } catch (err) {
            return null;
        }
    }
};

// API utilities
const API = {
    async get(url) {
        const res = await fetch(url, {
            headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
        });
        return res.json();
    },
    
    async post(url, data) {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + Auth.getToken()
            },
            body: JSON.stringify(data)
        });
        return res.json();
    },
    
    async delete(url) {
        const res = await fetch(url, {
            method: 'DELETE',
            headers: { 'Authorization': 'Bearer ' + Auth.getToken() }
        });
        return res.json();
    }
};

// Theme utilities
const Theme = {
    isDark: false,
    
    init() {
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            this.setDark(true);
        }
    },
    
    setDark(dark) {
        this.isDark = dark;
        if (dark) {
            document.documentElement.classList.add('dark');
        } else {
            document.documentElement.classList.remove('dark');
        }
    },
    
    toggle() {
        this.setDark(!this.isDark);
    }
};

// Game utilities
const GameUtils = {
    getPropertyColor(pos) {
        const colors = {
            1: '#8B4513', 3: '#8B4513',
            6: '#87CEEB', 8: '#87CEEB', 9: '#87CEEB',
            11: '#FF69B4', 13: '#FF69B4', 14: '#FF69B4',
            16: '#FFA500', 18: '#FFA500', 19: '#FFA500',
            21: '#FF0000', 23: '#FF0000', 24: '#FF0000',
            26: '#FFFF00', 27: '#FFFF00', 29: '#FFFF00',
            31: '#00FF00', 32: '#00FF00', 34: '#00FF00',
            37: '#0000FF', 39: '#0000FF'
        };
        return colors[pos] || 'transparent';
    },
    
    getPropertyName(pos) {
        const names = {
            1: 'Старый Крым', 3: 'Ростов-на-Дону',
            6: 'Калининград', 8: 'Ярославль', 9: 'Смоленск',
            11: 'Казань', 13: 'Нижний Новгород', 14: 'Самара',
            16: 'Екатеринбург', 18: 'Челябинск', 19: 'Омск',
            21: 'Новосибирск', 23: 'Красноярск', 24: 'Иркутск',
            26: 'Владивосток', 27: 'Хабаровск', 29: 'Мурманск',
            31: 'Архангельск', 32: 'Великий Новгород', 34: 'Псков',
            37: 'Санкт-Петербург', 39: 'Москва'
        };
        return names[pos] || '';
    },
    
    getPropertyPrice(pos) {
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
    },
    
    getTokenPosition(pos) {
        const positions = [
            {x: 7, y: 93}, {x: 14, y: 93}, {x: 22, y: 93}, {x: 30, y: 93}, {x: 38, y: 93},
            {x: 46, y: 93}, {x: 54, y: 93}, {x: 62, y: 93}, {x: 70, y: 93}, {x: 78, y: 93},
            {x: 93, y: 93},
            {x: 93, y: 86}, {x: 93, y: 78}, {x: 93, y: 70}, {x: 93, y: 62},
            {x: 93, y: 54}, {x: 93, y: 46}, {x: 93, y: 38}, {x: 93, y: 30}, {x: 93, y: 22},
            {x: 93, y: 7},
            {x: 86, y: 7}, {x: 78, y: 7}, {x: 70, y: 7}, {x: 62, y: 7},
            {x: 54, y: 7}, {x: 46, y: 7}, {x: 38, y: 7}, {x: 30, y: 7}, {x: 22, y: 7},
            {x: 7, y: 7},
            {x: 7, y: 14}, {x: 7, y: 22}, {x: 7, y: 30}, {x: 7, y: 38},
            {x: 7, y: 46}, {x: 7, y: 54}, {x: 7, y: 62}, {x: 7, y: 70}, {x: 7, y: 78}
        ];
        return positions[pos] || positions[0];
    }
};

// Socket connection manager
const SocketManager = {
    socket: null,
    
    connect() {
        this.socket = io({
            auth: { token: Auth.getToken() }
        });
        return this.socket;
    },
    
    getSocket() {
        if (!this.socket) return this.connect();
        return this.socket;
    },
    
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }
};

// Initialize theme on load
Theme.init();

// Export for use in other scripts
window.MonopolyApp = {
    Auth,
    API,
    Theme,
    GameUtils,
    SocketManager
};