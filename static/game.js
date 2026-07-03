// static/game.js - Полная клиентская логика с Canvas

class GlitchViewGame {
    constructor() {
        // Состояние
        this.sessionId = localStorage.getItem('glitch_session_id');
        this.gameState = null;
        this.isGameOver = false;
        this.isVictory = false;
        this.updateInterval = 2.0;
        this.lastUpdateTime = 0;
        this.animationFrame = null;
        
        // Canvas
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.cellSize = 25;
        
        // DOM
        this.statusEl = document.getElementById('status');
        this.glitchLevelEl = document.getElementById('glitchLevel');
        this.signalStrengthEl = document.getElementById('signalStrength');
        this.playerPosEl = document.getElementById('playerPos');
        this.enemyCountEl = document.getElementById('enemyCount');
        this.exitStatusEl = document.getElementById('exitStatus');
        this.updateTimerEl = document.getElementById('updateTimer');
        this.logEl = document.getElementById('log');
        this.glitchOverlay = document.getElementById('glitchOverlay');
        
        // Инициализация
        this.initEvents();
        this.resizeCanvas();
        
        if (!this.sessionId) {
            this.startNewGame();
        } else {
            this.loadGameState();
        }
        
        // Начинаем цикл обновления
        this.gameLoop();
    }
    
    resizeCanvas() {
        const container = this.canvas.parentElement;
        const size = Math.min(container.clientWidth - 20, 600);
        this.canvas.width = size;
        this.canvas.height = size;
        this.cellSize = size / 20; // 20x20 сетка
    }
    
    startNewGame() {
        this.addLog('Создание новой сессии...', 'system');
        
        fetch('/api/new-game', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({})
        })
        .then(res => res.json())
        .then(data => {
            this.sessionId = data.session_id;
            localStorage.setItem('glitch_session_id', this.sessionId);
            this.gameState = data.game_state;
            this.isGameOver = false;
            this.isVictory = false;
            this.lastUpdateTime = Date.now();
            this.render();
            this.addLog('🟢 Дрон активирован. Начните движение.', 'system');
            this.updateStatus('ONLINE');
        })
        .catch(err => {
            console.error('Ошибка:', err);
            this.addLog('❌ Ошибка подключения к серверу', 'error');
        });
    }
    
    loadGameState() {
        fetch(`/api/game-state?session_id=${this.sessionId}`)
        .then(res => res.json())
        .then(data => {
            if (data.error) {
                this.startNewGame();
                return;
            }
            this.gameState = data;
            this.render();
            this.addLog('📡 Состояние загружено', 'system');
        })
        .catch(() => {
            this.startNewGame();
        });
    }
    
    move(direction) {
        if (this.isGameOver || this.isVictory) return;
        
        fetch('/api/move', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({
                session_id: this.sessionId,
                direction: direction
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.moved) {
                this.gameState = data.game_state;
                this.render();
                
                if (data.result === 'game_over') {
                    this.isGameOver = true;
                    this.addLog('💀 Дрон уничтожен! Обнаружен враг.', 'error');
                    this.updateStatus('GAME OVER');
                } else if (data.result === 'victory') {
                    this.isVictory = true;
                    this.addLog('🎉 МИССИЯ ВЫПОЛНЕНА! Точка эвакуации достигнута.', 'victory');
                    this.updateStatus('VICTORY!');
                } else {
                    this.addLog(`➡️ Движение: ${direction}`, 'movement');
                }
            } else {
                this.addLog('🚫 Стена или граница', 'warning');
            }
        });
    }
    
    scan() {
        if (!this.gameState) return;
        
        this.addLog('🔍 Активирован сканер...', 'system');
        
        // Визуальный эффект сканирования
        this.canvas.style.filter = 'brightness(2)';
        setTimeout(() => {
            this.canvas.style.filter = 'brightness(1)';
        }, 300);
        
        // Обновляем данные
        fetch(`/api/game-state?session_id=${this.sessionId}`)
        .then(res => res.json())
        .then(data => {
            this.gameState = data;
            this.render();
            this.addLog(`📊 Обнаружено врагов: ${data.enemies.length}`, 'info');
        });
    }
    
    restart() {
        fetch('/api/restart', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({session_id: this.sessionId})
        })
        .then(res => res.json())
        .then(data => {
            this.gameState = data.game_state;
            this.isGameOver = false;
            this.isVictory = false;
            this.render();
            this.addLog('⟲ Игра перезапущена', 'system');
            this.updateStatus('ONLINE');
            this.logEl.innerHTML = '';
            this.addLog('🟢 Дрон перезапущен. Новая миссия.', 'system');
        });
    }
    
    render() {
        if (!this.gameState) return;
        
        const { heat_map, width, height, player, enemies, exit, sensors } = this.gameState;
        const canvas = this.canvas;
        const ctx = this.ctx;
        const cellSize = this.cellSize;
        
        // Очищаем
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Рендерим тепловую карту
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const heat = heat_map[y][x];
                const color = this.heatToColor(heat);
                
                ctx.fillStyle = color;
                ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
                
                // Сетка (эффект пикселизации)
                ctx.strokeStyle = 'rgba(0, 255, 65, 0.05)';
                ctx.lineWidth = 0.5;
                ctx.strokeRect(x * cellSize, y * cellSize, cellSize, cellSize);
            }
        }
        
        // Отмечаем датчики
        if (sensors) {
            sensors.forEach(([sx, sy]) => {
                ctx.fillStyle = 'rgba(0, 255, 0, 0.3)';
                ctx.beginPath();
                ctx.arc(sx * cellSize + cellSize/2, sy * cellSize + cellSize/2, cellSize/3, 0, Math.PI * 2);
                ctx.fill();
                
                // Пульсация датчика
                ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(sx * cellSize + cellSize/2, sy * cellSize + cellSize/2, cellSize/2, 0, Math.PI * 2);
                ctx.stroke();
            });
        }
        
        // Отмечаем выход
        if (exit) {
            const [ex, ey] = exit;
            ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
            ctx.fillRect(ex * cellSize, ey * cellSize, cellSize, cellSize);
            ctx.strokeStyle = '#00ffff';
            ctx.lineWidth = 2;
            ctx.strokeRect(ex * cellSize, ey * cellSize, cellSize, cellSize);
            
            // Стрелка к выходу
            ctx.fillStyle = '#00ffff';
            ctx.font = `${cellSize * 0.7}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('▼', ex * cellSize + cellSize/2, ey * cellSize + cellSize/2);
        }
        
        // Отмечаем врагов
        if (enemies) {
            enemies.forEach(([ex, ey]) => {
                // Тепловой след врага
                const gradient = ctx.createRadialGradient(
                    ex * cellSize + cellSize/2, ey * cellSize + cellSize/2, 0,
                    ex * cellSize + cellSize/2, ey * cellSize + cellSize/2, cellSize
                );
                gradient.addColorStop(0, 'rgba(255, 0, 0, 0.8)');
                gradient.addColorStop(1, 'rgba(255, 0, 0, 0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(ex * cellSize - cellSize, ey * cellSize - cellSize, cellSize * 3, cellSize * 3);
                
                // Сам враг
                ctx.fillStyle = '#ff0000';
                ctx.beginPath();
                ctx.arc(ex * cellSize + cellSize/2, ey * cellSize + cellSize/2, cellSize * 0.4, 0, Math.PI * 2);
                ctx.fill();
                
                // Красное свечение
                ctx.shadowColor = '#ff0000';
                ctx.shadowBlur = 20;
                ctx.fill();
                ctx.shadowBlur = 0;
            });
        }
        
        // Отмечаем игрока
        if (player) {
            const [px, py] = player;
            // Тепловой след игрока
            const gradient = ctx.createRadialGradient(
                px * cellSize + cellSize/2, py * cellSize + cellSize/2, 0,
                px * cellSize + cellSize/2, py * cellSize + cellSize/2, cellSize * 0.8
            );
            gradient.addColorStop(0, 'rgba(0, 255, 65, 0.8)');
            gradient.addColorStop(1, 'rgba(0, 255, 65, 0)');
            ctx.fillStyle = gradient;
            ctx.fillRect(px * cellSize - cellSize, py * cellSize - cellSize, cellSize * 3, cellSize * 3);
            
            // Сам игрок
            ctx.fillStyle = '#00ff41';
            ctx.beginPath();
            ctx.arc(px * cellSize + cellSize/2, py * cellSize + cellSize/2, cellSize * 0.35, 0, Math.PI * 2);
            ctx.fill();
            
            // Зеленое свечение
            ctx.shadowColor = '#00ff41';
            ctx.shadowBlur = 25;
            ctx.fill();
            ctx.shadowBlur = 0;
        }
        
        // Обновляем HUD
        if (player) {
            this.playerPosEl.textContent = `${player[0]}, ${player[1]}`;
        }
        if (enemies) {
            this.enemyCountEl.textContent = enemies.length;
        }
        if (exit) {
            this.exitStatusEl.textContent = this.isVictory ? '✅' : '▼';
        }
        
        // Обновляем уровень глитча
        if (this.gameState.glitch_intensity !== undefined) {
            const glitchPercent = Math.round(this.gameState.glitch_intensity * 100);
            this.glitchLevelEl.textContent = `ГЛИТЧ: ${glitchPercent}%`;
            
            // Визуальный глитч-эффект
            if (glitchPercent > 60) {
                this.canvas.style.filter = `blur(${glitchPercent / 20}px)`;
                this.glitchOverlay.style.opacity = glitchPercent / 100;
            } else {
                this.canvas.style.filter = 'none';
                this.glitchOverlay.style.opacity = 0;
            }
        }
    }
    
    heatToColor(heat) {
        // Преобразование тепла в цвет (синий -> зеленый -> красный)
        const normalized = Math.min(heat / 255, 1);
        
        if (normalized < 0.5) {
            // Холодный (синий -> зеленый)
            const ratio = normalized / 0.5;
            const r = Math.round(0);
            const g = Math.round(ratio * 255);
            const b = Math.round((1 - ratio) * 255);
            return `rgb(${r}, ${g}, ${b})`;
        } else {
            // Горячий (зеленый -> красный)
            const ratio = (normalized - 0.5) / 0.5;
            const r = Math.round(ratio * 255);
            const g = Math.round((1 - ratio) * 255);
            const b = Math.round(0);
            return `rgb(${r}, ${g}, ${b})`;
        }
    }
    
    gameLoop() {
        this.animationFrame = requestAnimationFrame(() => this.gameLoop());
        
        const now = Date.now();
        if (now - this.lastUpdateTime > this.updateInterval * 1000 && !this.isGameOver && !this.isVictory) {
            // Обновляем мир на сервере
            fetch('/api/update', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({session_id: this.sessionId})
            })
            .then(res => res.json())
            .then(data => {
                if (data.game_state) {
                    this.gameState = data.game_state;
                    this.render();
                    
                    if (data.result === 'game_over') {
                        this.isGameOver = true;
                        this.addLog('💀 Дрон уничтожен!', 'error');
                        this.updateStatus('GAME OVER');
                    } else if (data.result === 'victory') {
                        this.isVictory = true;
                        this.addLog('🎉 ВЫ ПОБЕДИЛИ!', 'victory');
                        this.updateStatus('VICTORY!');
                    }
                }
            });
            this.lastUpdateTime = now;
        }
    }
    
    addLog(message, type = 'info') {
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = message;
        this.logEl.appendChild(entry);
        this.logEl.scrollTop = this.logEl.scrollHeight;
    }
    
    updateStatus(status) {
        this.statusEl.textContent = status;
        if (status.includes('GAME OVER')) {
            this.statusEl.style.color = '#ff0000';
        } else if (status.includes('VICTORY')) {
            this.statusEl.style.color = '#ffff00';
        } else {
            this.statusEl.style.color = '#00ff41';
        }
    }
    
    initEvents() {
        // Кнопки движения
        document.querySelectorAll('.btn-move').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const dir = e.currentTarget.dataset.dir;
                this.move(dir);
            });
        });
        
        // Клавиатура
        document.addEventListener('keydown', (e) => {
            const keyMap = {
                'ArrowUp': 'up',
                'ArrowDown': 'down',
                'ArrowLeft': 'left',
                'ArrowRight': 'right',
                'w': 'up',
                's': 'down',
                'a': 'left',
                'd': 'right'
            };
            if (keyMap[e.key]) {
                e.preventDefault();
                this.move(keyMap[e.key]);
            }
        });
        
        // Кнопки
        document.getElementById('scanBtn').addEventListener('click', () => this.scan());
        document.getElementById('restartBtn').addEventListener('click', () => this.restart());
        
        // Ресайз окна
        window.addEventListener('resize', () => {
            this.resizeCanvas();
            this.render();
        });
    }
}

// Запуск игры
document.addEventListener('DOMContentLoaded', () => {
    window.game = new GlitchViewGame();
});
