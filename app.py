# app.py - Полный сервер с симуляцией мира

from flask import Flask, render_template, jsonify, request, session
import random
import math
import json
from datetime import datetime
import os

app = Flask(__name__)
app.secret_key = os.environ.get('SECRET_KEY', 'dev-key-12345')

# ============ КОНФИГУРАЦИЯ ИГРЫ ============

GRID_SIZE = 20  # 20x20 сетка
CELL_SIZE = 30  # пикселей на клетку
UPDATE_INTERVAL = 2.0  # секунды между обновлениями

# Типы клеток
EMPTY = 0
WALL = 1
PLAYER = 2
ENEMY = 3
SENSOR = 4
EXIT = 5
COLD_ZONE = 6  # холодные стены

# ============ ГЕНЕРАТОР ЛАБИРИНТА ============

class GlitchWorld:
    """Мир с тепловой матрицей"""
    
    def __init__(self, seed=None):
        if seed:
            random.seed(seed)
        else:
            random.seed()
        
        self.width = GRID_SIZE
        self.height = GRID_SIZE
        self.grid = [[EMPTY for _ in range(self.width)] for _ in range(self.height)]
        
        # Позиции объектов
        self.player_pos = [1, 1]
        self.enemies = []
        self.sensors = []
        self.exit_pos = None
        
        # Тепловая матрица (0-255)
        self.heat_map = [[0 for _ in range(self.width)] for _ in range(self.height)]
        
        # Генерация лабиринта
        self.generate_maze()
        self.place_objects()
        self.update_heat_map()
        
        # История движений для глитчей
        self.history = []
        self.glitch_intensity = 0.3
        
    def generate_maze(self):
        """Генерация лабиринта методом DFS"""
        # Заполняем стенами
        for i in range(self.height):
            for j in range(self.width):
                if i % 2 == 0 or j % 2 == 0:
                    self.grid[i][j] = WALL
                else:
                    self.grid[i][j] = EMPTY
        
        # DFS для создания проходов
        def carve(x, y):
            directions = [(0, 2), (2, 0), (0, -2), (-2, 0)]
            random.shuffle(directions)
            
            for dx, dy in directions:
                nx, ny = x + dx, y + dy
                if 0 < nx < self.width and 0 < ny < self.height:
                    if self.grid[ny][nx] == WALL:
                        self.grid[ny][nx] = EMPTY
                        self.grid[y + dy//2][x + dx//2] = EMPTY
                        carve(nx, ny)
        
        # Начинаем с центра
        carve(1, 1)
        
        # Добавляем холодные зоны (стены с пониженной температурой)
        for i in range(self.height):
            for j in range(self.width):
                if self.grid[i][j] == WALL:
                    self.heat_map[i][j] = random.randint(20, 50)  # холодные стены
        
    def place_objects(self):
        """Размещение объектов на карте"""
        # Выход (в правом нижнем углу)
        exit_x, exit_y = self.width - 2, self.height - 2
        while self.grid[exit_y][exit_x] != EMPTY:
            exit_x -= 2
            exit_y -= 2
        self.exit_pos = [exit_x, exit_y]
        self.grid[exit_y][exit_x] = EXIT
        self.heat_map[exit_y][exit_x] = 100
        
        # Датчики (3-5 штук)
        num_sensors = random.randint(3, 5)
        for _ in range(num_sensors):
            attempts = 0
            while attempts < 100:
                x = random.randint(2, self.width - 3)
                y = random.randint(2, self.height - 3)
                if self.grid[y][x] == EMPTY and [x, y] != self.player_pos and [x, y] != self.exit_pos:
                    self.grid[y][x] = SENSOR
                    self.sensors.append([x, y])
                    self.heat_map[y][x] = random.randint(150, 200)  # теплые датчики
                    break
                attempts += 1
        
        # Враги (2-4 штуки)
        num_enemies = random.randint(2, 4)
        for _ in range(num_enemies):
            attempts = 0
            while attempts < 100:
                x = random.randint(1, self.width - 2)
                y = random.randint(1, self.height - 2)
                if self.grid[y][x] == EMPTY and [x, y] != self.player_pos and [x, y] != self.exit_pos:
                    # Проверяем, что враг не рядом с датчиком
                    far_from_sensors = True
                    for sx, sy in self.sensors:
                        if abs(x - sx) + abs(y - sy) < 3:
                            far_from_sensors = False
                            break
                    if far_from_sensors:
                        enemy = {
                            'x': x,
                            'y': y,
                            'direction': random.choice(['up', 'down', 'left', 'right']),
                            'speed': random.choice([1, 2]),  # шагов за обновление
                            'heat': random.randint(200, 255)  # горячие враги
                        }
                        self.enemies.append(enemy)
                        self.grid[y][x] = ENEMY
                        self.heat_map[y][x] = enemy['heat']
                        break
                attempts += 1
    
    def update(self):
        """Обновление состояния мира (шаг игры)"""
        # Сохраняем историю для глитчей
        self.history.append({
            'player': self.player_pos.copy(),
            'enemies': [[e['x'], e['y']] for e in self.enemies],
            'time': datetime.now().isoformat()
        })
        if len(self.history) > 10:
            self.history.pop(0)
        
        # Двигаем врагов
        for enemy in self.enemies:
            # Патрулирование с изменением направления
            if random.random() < 0.2:  # 20% шанс сменить направление
                enemy['direction'] = random.choice(['up', 'down', 'left', 'right'])
            
            # Движение
            for _ in range(enemy['speed']):
                new_x, new_y = enemy['x'], enemy['y']
                if enemy['direction'] == 'up':
                    new_y -= 1
                elif enemy['direction'] == 'down':
                    new_y += 1
                elif enemy['direction'] == 'left':
                    new_x -= 1
                elif enemy['direction'] == 'right':
                    new_x += 1
                
                # Проверка границ и стен
                if 0 <= new_x < self.width and 0 <= new_y < self.height:
                    if self.grid[new_y][new_x] not in [WALL, EXIT, SENSOR]:
                        # Очищаем старую позицию
                        self.grid[enemy['y']][enemy['x']] = EMPTY
                        self.heat_map[enemy['y']][enemy['x']] = 0
                        
                        # Обновляем позицию
                        enemy['x'], enemy['y'] = new_x, new_y
                        self.grid[enemy['y']][enemy['x']] = ENEMY
                        self.heat_map[enemy['y']][enemy['x']] = enemy['heat']
        
        # Обновляем тепловую карту (распространение тепла)
        self.update_heat_map()
        
        # Проверка столкновений с врагами
        for enemy in self.enemies:
            if enemy['x'] == self.player_pos[0] and enemy['y'] == self.player_pos[1]:
                return 'game_over'
        
        # Проверка выхода
        if self.player_pos[0] == self.exit_pos[0] and self.player_pos[1] == self.exit_pos[1]:
            return 'victory'
        
        return 'continue'
    
    def update_heat_map(self):
        """Обновление тепловой матрицы с распространением тепла"""
        # Создаем копию
        new_heat = [[0 for _ in range(self.width)] for _ in range(self.height)]
        
        # Распространение тепла от источников
        for i in range(self.height):
            for j in range(self.width):
                if self.heat_map[i][j] > 0:
                    # Источник тепла
                    new_heat[i][j] = self.heat_map[i][j]
                    
                    # Распространение на соседей
                    for di in [-1, 0, 1]:
                        for dj in [-1, 0, 1]:
                            if di == 0 and dj == 0:
                                continue
                            ni, nj = i + di, j + dj
                            if 0 <= ni < self.height and 0 <= nj < self.width:
                                if self.grid[ni][nj] != WALL:
                                    # Тепло распространяется с затуханием
                                    new_heat[ni][nj] = max(new_heat[ni][nj], 
                                                          int(self.heat_map[i][j] * 0.7))
        
        # Добавляем шум (глитч-эффект)
        for i in range(self.height):
            for j in range(self.width):
                if new_heat[i][j] == 0 and self.grid[i][j] != WALL:
                    # Случайный шум в пустых клетках
                    if random.random() < 0.1:
                        new_heat[i][j] = random.randint(0, 30)
        
        self.heat_map = new_heat
    
    def move_player(self, direction):
        """Движение игрока"""
        x, y = self.player_pos
        if direction == 'up':
            y -= 1
        elif direction == 'down':
            y += 1
        elif direction == 'left':
            x -= 1
        elif direction == 'right':
            x += 1
        
        # Проверка границ и стен
        if 0 <= x < self.width and 0 <= y < self.height:
            if self.grid[y][x] != WALL:
                # Очищаем старую позицию
                self.grid[self.player_pos[1]][self.player_pos[0]] = EMPTY
                self.heat_map[self.player_pos[1]][self.player_pos[0]] = 0
                
                # Обновляем позицию
                self.player_pos = [x, y]
                self.grid[y][x] = PLAYER
                self.heat_map[y][x] = 80  # тело игрока теплое
                return True
        return False
    
    def get_state(self):
        """Получение текущего состояния для клиента"""
        # Добавляем глитч-эффекты
        glitched_heat = [row.copy() for row in self.heat_map]
        
        # Глитч: сдвиг строк
        if random.random() < self.glitch_intensity:
            shift = random.randint(-3, 3)
            if shift != 0:
                glitched_heat = glitched_heat[shift:] + glitched_heat[:shift]
        
        # Глитч: инверсия цветов
        if random.random() < self.glitch_intensity * 0.5:
            for i in range(self.height):
                for j in range(self.width):
                    glitched_heat[i][j] = 255 - glitched_heat[i][j]
        
        # Глитч: случайные пиксели
        if random.random() < self.glitch_intensity * 0.3:
            for _ in range(random.randint(1, 5)):
                x = random.randint(0, self.width - 1)
                y = random.randint(0, self.height - 1)
                glitched_heat[y][x] = random.randint(0, 255)
        
        return {
            'heat_map': glitched_heat,
            'width': self.width,
            'height': self.height,
            'player': self.player_pos,
            'enemies': [[e['x'], e['y']] for e in self.enemies],
            'exit': self.exit_pos,
            'sensors': self.sensors,
            'glitch_intensity': self.glitch_intensity,
            'timestamp': datetime.now().isoformat()
        }

# ============ ХРАНИЛИЩЕ ИГР ============

games = {}

def get_or_create_game(session_id):
    """Получает или создает игру для сессии"""
    if session_id not in games:
        games[session_id] = GlitchWorld(session_id)
    return games[session_id]

# ============ МАРШРУТЫ ============

@app.route('/')
def index():
    """Главная страница"""
    return render_template('index.html')

@app.route('/api/new-game', methods=['POST'])
def new_game():
    """Создает новую игру"""
    session_id = request.json.get('session_id')
    if not session_id:
        session_id = str(random.randint(100000, 999999))
    
    games[session_id] = GlitchWorld(session_id)
    
    return jsonify({
        'session_id': session_id,
        'game_state': games[session_id].get_state()
    })

@app.route('/api/game-state', methods=['GET'])
def get_game_state():
    """Получает текущее состояние игры"""
    session_id = request.args.get('session_id')
    if not session_id or session_id not in games:
        return jsonify({'error': 'Игра не найдена'}), 404
    
    game = games[session_id]
    return jsonify(game.get_state())

@app.route('/api/move', methods=['POST'])
def move_player():
    """Движение игрока"""
    data = request.json
    session_id = data.get('session_id')
    direction = data.get('direction')
    
    if not session_id or session_id not in games:
        return jsonify({'error': 'Игра не найдена'}), 404
    
    game = games[session_id]
    moved = game.move_player(direction)
    
    if moved:
        # Обновляем мир
        result = game.update()
        return jsonify({
            'moved': True,
            'game_state': game.get_state(),
            'result': result
        })
    else:
        return jsonify({
            'moved': False,
            'game_state': game.get_state()
        })

@app.route('/api/update', methods=['POST'])
def update_game():
    """Принудительное обновление мира"""
    session_id = request.json.get('session_id')
    if not session_id or session_id not in games:
        return jsonify({'error': 'Игра не найдена'}), 404
    
    game = games[session_id]
    result = game.update()
    
    return jsonify({
        'game_state': game.get_state(),
        'result': result
    })

@app.route('/api/restart', methods=['POST'])
def restart_game():
    """Перезапуск игры"""
    session_id = request.json.get('session_id')
    if not session_id or session_id not in games:
        return jsonify({'error': 'Игра не найдена'}), 404
    
    games[session_id] = GlitchWorld(session_id)
    
    return jsonify({
        'game_state': games[session_id].get_state()
    })

# ============ ЗАПУСК ============

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
