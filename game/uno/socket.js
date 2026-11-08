import { randomBytes, randomUUID } from 'node:crypto';
import {
  UNO_MIN_PLAYERS, UNO_MAX_PLAYERS, UNO_COLORS,
  startRound, nextPlayerId, advanceTurn, drawCards,
  isPlayable, hasMatchingColor, addMessage, finishRound, buildPlayerView
} from './engine.js';

const makeCode = () => randomBytes(3).toString('hex').toUpperCase();
const clean = (value, max = 32) => String(value ?? '').trim().slice(0, max).replace(/[<>]/g, '');
const mod = (n, m) => ((n % m) + m) % m;

export function attachUnoNamespace(io) {
  const namespace = io.of('/uno');
  const rooms = new Map();
  const redisUrl = (process.env.UPSTASH_REDIS_REST_URL || '').replace(/\/$/, '');
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN || '';
  const persistenceEnabled = !!(redisUrl && redisToken);
  const persistenceKey = 'ma-soi-huyen-bi:uno-rooms:v1';
  let saveQueue = Promise.resolve();

  function snapshot() {
    return JSON.stringify([...rooms.values()].map(room => ({
      ...room,
      players: room.players.map(player => ({ ...player, socketId: null, online: false }))
    })));
  }

  function persist() {
    if (!persistenceEnabled) return;
    const payload = snapshot();
    saveQueue = saveQueue.catch(() => {}).then(async () => {
      const response = await fetch(redisUrl + '/set/' + encodeURIComponent(persistenceKey), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + redisToken, 'Content-Type': 'text/plain' },
        body: payload
      });
      if (!response.ok) throw Error('UNO Redis snapshot failed: ' + response.status);
    }).catch(error => console.error('Không thể lưu phòng UNO:', error.message));
  }

  async function restoreRooms() {
    if (!persistenceEnabled) return;
    try {
      const response = await fetch(redisUrl + '/get/' + encodeURIComponent(persistenceKey), {
        headers: { Authorization: 'Bearer ' + redisToken }
      });
      if (!response.ok) throw Error('UNO Redis restore failed: ' + response.status);
      const result = await response.json();
      if (!result.result) return;
      const saved = JSON.parse(result.result);
      if (!Array.isArray(saved)) throw Error('UNO room snapshot không hợp lệ.');
      for (const room of saved) {
        if (!room || !room.code || !Array.isArray(room.players)) continue;
        room.players = room.players.filter(player => player && player.id && Array.isArray(player.hand))
          .map(player => ({ ...player, socketId: null, online: false }));
        if (!room.players.length) continue;
        if (room.phase === 'lobby' && Date.now() - Number(room.createdAt || Date.now()) > 4 * 60 * 60 * 1000) continue;
        rooms.set(room.code, room);
      }
      console.log('Đã khôi phục', rooms.size, 'phòng UNO.');
    } catch (error) {
      console.error('Không thể khôi phục phòng UNO:', error.message);
      throw error;
    }
  }

  function ack(callback, value) {
    if (typeof callback === 'function') callback(value);
  }

  function fail(callback, message) {
    ack(callback, { ok: false, error: message });
  }

  function publicRoom(room) {
    return {
      code: room.code,
      name: room.name,
      phase: room.phase,
      count: room.players.length,
      max: UNO_MAX_PLAYERS,
      players: room.players.map(player => ({
        id: player.id,
        name: player.name,
        online: !!player.online,
        ready: !!player.ready,
        isHost: player.id === room.hostId,
        cardCount: player.hand.length
      }))
    };
  }

  function emitRoom(room) {
    persist();
    namespace.emit('uno:rooms-updated');
    for (const player of room.players) {
      if (player.socketId) namespace.to(player.socketId).emit('uno:state', buildPlayerView(room, player.id));
    }
  }

  function authenticate(socket, callback) {
    const room = rooms.get(socket.data.roomCode);
    const player = room && room.players.find(item => item.id === socket.data.playerId);
    if (!room || !player || player.socketId !== socket.id) {
      fail(callback, 'Phiên UNO không hợp lệ. Hãy kết nối lại phòng.');
      return null;
    }
    return { room, player };
  }

  function clearUnoWindow(room, actingPlayerId) {
    if (room.pendingUno && room.pendingUno.nextTurnPlayerId === actingPlayerId) {
      room.pendingUno = null;
    }
  }

  function currentTurn(room, player, callback) {
    if (room.phase !== 'playing') {
      fail(callback, 'Ván UNO hiện không hoạt động.');
      return false;
    }
    if (room.challenge) {
      fail(callback, 'Hãy xử lý lượt thách thức +4 trước.');
      return false;
    }
    if (room.currentPlayerId !== player.id) {
      fail(callback, 'Chưa đến lượt của bạn.');
      return false;
    }
    clearUnoWindow(room, player.id);
    return true;
  }

  function drawForPenalty(room, player, count) {
    const cards = drawCards(room, player, count);
    if (cards.length) addMessage(room, player.name + ' phải rút ' + cards.length + ' lá bài.');
    return cards.length;
  }

  function deleteRoom(room) {
    rooms.delete(room.code);
    persist();
    namespace.emit('uno:rooms-updated');
  }

  function finishIfSinglePlayer(room) {
    if (room.phase === 'playing' && room.players.length === 1) {
      finishRound(room, room.players[0].id);
      return true;
    }
    if (!room.players.length) {
      deleteRoom(room);
      return true;
    }
    return false;
  }

  function removePlayer(room, player) {
    const index = room.players.findIndex(item => item.id === player.id);
    if (index < 0) return;
    const wasCurrent = room.currentPlayerId === player.id;
    const wasChallenger = room.challenge?.challengerId === player.id;
    room.players.splice(index, 1);
    if (room.pendingUno?.playerId === player.id) room.pendingUno = null;
    if (room.challenge?.offenderId === player.id || wasChallenger) room.challenge = null;

    if (room.players.length && wasCurrent) {
      const nextIndex = room.direction === 1 ? mod(index, room.players.length) : mod(index - 1, room.players.length);
      room.currentPlayerId = room.players[nextIndex].id;
      room.turnDrawnCardId = null;
    }
    if (!room.players.some(item => item.id === room.hostId)) room.hostId = room.players[0]?.id || null;
    if (!room.players.length) {
      deleteRoom(room);
      return;
    }
    addMessage(room, player.name + ' đã rời phòng UNO.');
    if (finishIfSinglePlayer(room)) return;
    if (room.phase === 'lobby' && room.players.length) room.players[0].ready = true;
    emitRoom(room);
  }

  function advanceAfterPenalty(room, challengerId) {
    room.currentPlayerId = nextPlayerId(room, challengerId, 1);
    room.turnDrawnCardId = null;
  }

  namespace.on('connection', socket => {
    socket.on('uno:room:list', (data, callback) => {
      if (typeof data === 'function') callback = data;
      const now = Date.now();
      let changed = false;
      for (const [code, room] of rooms) {
        if (room.phase === 'lobby' && now - Number(room.createdAt || now) > 4 * 60 * 60 * 1000) {
          rooms.delete(code);
          changed = true;
        }
      }
      if (changed) persist();
      ack(callback, {
        ok: true,
        rooms: [...rooms.values()]
          .filter(room => room.phase === 'lobby' && !room.private && room.players.length < UNO_MAX_PLAYERS)
          .map(publicRoom)
      });
    });

    socket.on('uno:room:create', (data = {}, callback) => {
      const name = clean(data.name, 28) || 'UNO Party';
      const playerName = clean(data.playerName, 18) || 'Khách';
      const id = randomUUID();
      let roomCode = makeCode();
      while (rooms.has(roomCode)) roomCode = makeCode();
      const now = Date.now();
      const player = { id, name: playerName, socketId: socket.id, online: true, ready: true, hand: [] };
      const room = {
        code: roomCode, name, private: !!data.private, hostId: id,
        phase: 'lobby', createdAt: now, players: [player],
        drawPile: [], discardPile: [], currentColor: null, direction: 1,
        currentPlayerId: null, turnDrawnCardId: null, challenge: null,
        pendingUno: null, winnerId: null, results: [], messages: [],
        lastAction: '', lastActivity: now
      };
      rooms.set(roomCode, room);
      socket.data = { roomCode, playerId: id };
      ack(callback, { ok: true, code: roomCode, playerId: id });
      addMessage(room, playerName + ' đã tạo phòng UNO.');
      emitRoom(room);
    });

    socket.on('uno:room:join', (data = {}, callback) => {
      const code = clean(data.code, 8).toUpperCase();
      const room = rooms.get(code);
      if (!room) return fail(callback, 'Không tìm thấy phòng UNO.');
      if (room.phase !== 'lobby') return fail(callback, 'Ván UNO đã bắt đầu.');
      if (room.players.length >= UNO_MAX_PLAYERS) return fail(callback, 'Phòng đã đủ người.');
      const name = clean(data.playerName, 18) || 'Khách';
      if (room.players.some(player => player.name.toLowerCase() === name.toLowerCase())) {
        return fail(callback, 'Tên này đã có trong phòng. Hãy chọn biệt danh khác.');
      }
      const player = { id: randomUUID(), name, socketId: socket.id, online: true, ready: false, hand: [] };
      room.players.push(player);
      room.lastActivity = Date.now();
      socket.data = { roomCode: code, playerId: player.id };
      ack(callback, { ok: true, code, playerId: player.id });
      addMessage(room, name + ' đã tham gia phòng.');
      emitRoom(room);
    });

    socket.on('uno:room:resume', (data = {}, callback) => {
      const code = clean(data.code, 8).toUpperCase();
      const room = rooms.get(code);
      const player = room?.players.find(item => item.id === data.playerId);
      if (!room || !player) return fail(callback, 'Không tìm thấy phiên UNO để khôi phục.');
      const previousSocketId = player.socketId;
      if (previousSocketId && previousSocketId !== socket.id) {
        const previousSocket = namespace.sockets.get(previousSocketId);
        if (previousSocket) {
          previousSocket.emit('uno:session:replaced');
          previousSocket.data = {};
        }
      }
      player.socketId = socket.id;
      player.online = true;
      room.lastActivity = Date.now();
      socket.data = { roomCode: code, playerId: player.id };
      ack(callback, { ok: true });
      emitRoom(room);
    });

    socket.on('uno:room:ready', (value, callback) => {
      const auth = authenticate(socket, callback);
      if (!auth) return;
      const { room, player } = auth;
      if (room.phase !== 'lobby') return fail(callback, 'Ván UNO đã bắt đầu.');
      player.ready = player.id === room.hostId ? true : !!value;
      emitRoom(room);
      ack(callback, { ok: true });
    });

    socket.on('uno:room:start', (_, callback) => {
      const auth = authenticate(socket, callback);
      if (!auth) return;
      const { room, player } = auth;
      if (room.phase !== 'lobby') return fail(callback, 'Phòng không còn ở trạng thái chờ.');
      if (player.id !== room.hostId) return fail(callback, 'Chỉ chủ phòng mới được bắt đầu.');
      if (room.players.length < UNO_MIN_PLAYERS) return fail(callback, 'Cần ít nhất 2 người để bắt đầu UNO.');
      if (room.players.length > UNO_MAX_PLAYERS) return fail(callback, 'Phòng vượt quá số người tối đa.');
      if (room.players.some(item => !item.ready)) return fail(callback, 'Vẫn còn người chơi chưa sẵn sàng.');
      startRound(room);
      room.lastActivity = Date.now();
      addMessage(room, 'Ván UNO bắt đầu. Chúc mọi người chơi vui!');
      emitRoom(room);
      ack(callback, { ok: true });
    });

    socket.on('uno:game:play', (data = {}, callback) => {
      const auth = authenticate(socket, callback);
      if (!auth) return;
      const { room, player } = auth;
      if (!currentTurn(room, player, callback)) return;
      const cardIndex = player.hand.findIndex(card => card.id === data.cardId);
      if (cardIndex < 0) return fail(callback, 'Lá bài này không có trong tay bạn.');
      if (room.turnDrawnCardId && room.turnDrawnCardId !== data.cardId) {
        return fail(callback, 'Sau khi rút, bạn chỉ có thể đánh lá bài vừa rút.');
      }
      const card = player.hand[cardIndex];
      const topCard = room.discardPile.at(-1);
      if (!isPlayable(card, topCard, room.currentColor)) return fail(callback, 'Lá bài không hợp lệ. Hãy chọn đúng màu, số hoặc ký hiệu.');
      if ((card.type === 'wild' || card.type === 'wild4') && !UNO_COLORS.includes(data.color)) {
        return fail(callback, 'Hãy chọn màu tiếp theo.');
      }

      const previousColor = room.currentColor;
      const hadMatchingColor = card.type === 'wild4' ? hasMatchingColor(player.hand, previousColor) : false;
      player.hand.splice(cardIndex, 1);
      room.discardPile.push(card);
      room.currentColor = card.type === 'wild' || card.type === 'wild4' ? data.color : card.color;
      room.turnDrawnCardId = null;
      room.lastActivity = Date.now();
      room.lastAction = player.name + ' đã đánh một lá bài.';
      const cardLabel = card.type === 'number' ? card.value :
        card.type === 'draw2' ? '+2' : card.type === 'wild4' ? 'Đổi màu +4' :
        card.type === 'wild' ? 'Đổi màu' : card.type === 'reverse' ? 'Đảo chiều' : 'Bỏ lượt';
      addMessage(room, player.name + ' đã đánh ' + cardLabel + '.');

      if (card.type === 'wild4') {
        const challengerId = nextPlayerId(room, player.id, 1);
        room.challenge = {
          offenderId: player.id, challengerId, previousColor,
          hadMatchingColor, pendingWinnerId: player.hand.length === 0 ? player.id : null
        };
        room.currentPlayerId = challengerId;
        room.pendingUno = player.hand.length === 1 ? { playerId: player.id, nextTurnPlayerId: challengerId } : null;
        emitRoom(room);
        ack(callback, { ok: true });
        return;
      }

      if (player.hand.length === 1) {
        room.pendingUno = { playerId: player.id, nextTurnPlayerId: null };
      } else if (room.pendingUno?.playerId === player.id) {
        room.pendingUno = null;
      }

      if (card.type === 'reverse') {
        room.direction *= -1;
        advanceTurn(room, room.players.length === 2 ? 2 : 1);
      } else if (card.type === 'skip') {
        advanceTurn(room, 2);
      } else if (card.type === 'draw2') {
        const targetId = nextPlayerId(room, player.id, 1);
        const target = room.players.find(item => item.id === targetId);
        if (target) drawForPenalty(room, target, 2);
        advanceTurn(room, 2);
      } else {
        advanceTurn(room, 1);
      }

      if (room.pendingUno?.playerId === player.id) room.pendingUno.nextTurnPlayerId = room.currentPlayerId;
      if (player.hand.length === 0) finishRound(room, player.id);
      emitRoom(room);
      ack(callback, { ok: true });
    });

    socket.on('uno:game:draw', (_, callback) => {
      const auth = authenticate(socket, callback);
      if (!auth) return;
      const { room, player } = auth;
      if (!currentTurn(room, player, callback)) return;
      if (room.turnDrawnCardId) return fail(callback, 'Bạn đã rút bài trong lượt này.');
      const drawn = drawCards(room, player, 1);
      if (!drawn.length) return fail(callback, 'Không còn bài để rút.');
      room.lastAction = player.name + ' đã rút một lá bài.';
      addMessage(room, player.name + ' đã rút một lá bài.');
      if (isPlayable(drawn[0], room.discardPile.at(-1), room.currentColor)) {
        room.turnDrawnCardId = drawn[0].id;
      } else {
        advanceTurn(room, 1);
      }
      emitRoom(room);
      ack(callback, { ok: true, playable: !!room.turnDrawnCardId });
    });

    socket.on('uno:game:pass', (_, callback) => {
      const auth = authenticate(socket, callback);
      if (!auth) return;
      const { room, player } = auth;
      if (!currentTurn(room, player, callback)) return;
      if (!room.turnDrawnCardId) return fail(callback, 'Bạn chỉ có thể kết thúc lượt sau khi đã rút một lá bài.');
      addMessage(room, player.name + ' đã kết thúc lượt.');
      advanceTurn(room, 1);
      emitRoom(room);
      ack(callback, { ok: true });
    });

    socket.on('uno:game:call', (_, callback) => {
      const auth = authenticate(socket, callback);
      if (!auth) return;
      const { room, player } = auth;
      if (room.phase !== 'playing' || player.hand.length !== 1 || room.pendingUno?.playerId !== player.id) {
        return fail(callback, 'Bạn chưa ở trạng thái cần gọi UNO.');
      }
      room.pendingUno = null;
      addMessage(room, player.name + ' đã gọi UNO!');
      emitRoom(room);
      ack(callback, { ok: true });
    });

    socket.on('uno:game:catch', (_, callback) => {
      const auth = authenticate(socket, callback);
      if (!auth) return;
      const { room, player } = auth;
      const pending = room.pendingUno;
      if (room.phase !== 'playing' || !pending || pending.playerId === player.id) {
        return fail(callback, 'Không có người chơi nào để bắt lỗi UNO.');
      }
      const offender = room.players.find(item => item.id === pending.playerId);
      if (!offender || offender.hand.length !== 1) {
        room.pendingUno = null;
        emitRoom(room);
        return fail(callback, 'Lượt gọi UNO đã kết thúc.');
      }
      drawForPenalty(room, offender, 2);
      room.pendingUno = null;
      addMessage(room, player.name + ' đã bắt lỗi UNO. ' + offender.name + ' phải rút 2 lá.');
      emitRoom(room);
      ack(callback, { ok: true });
    });

    socket.on('uno:game:challenge', (_, callback) => {
      const auth = authenticate(socket, callback);
      if (!auth) return;
      const { room, player } = auth;
      const challenge = room.challenge;
      if (!challenge || challenge.challengerId !== player.id || room.currentPlayerId !== player.id) {
        return fail(callback, 'Bạn không có lượt thách thức.');
      }
      const offender = room.players.find(item => item.id === challenge.offenderId);
      if (challenge.hadMatchingColor) {
        if (offender) drawForPenalty(room, offender, 4);
        room.currentPlayerId = player.id;
        room.turnDrawnCardId = null;
        addMessage(room, player.name + ' thách thức thành công. Người đánh +4 phải rút 4 lá.');
      } else {
        drawForPenalty(room, player, 6);
        addMessage(room, player.name + ' thách thức không thành công và phải rút 6 lá.');
        advanceAfterPenalty(room, player.id);
      }
      const pendingWinner = challenge.pendingWinnerId;
      room.challenge = null;
      if (pendingWinner && !challenge.hadMatchingColor) finishRound(room, pendingWinner);
      emitRoom(room);
      ack(callback, { ok: true, challenged: true });
    });

    socket.on('uno:game:accept', (_, callback) => {
      const auth = authenticate(socket, callback);
      if (!auth) return;
      const { room, player } = auth;
      const challenge = room.challenge;
      if (!challenge || challenge.challengerId !== player.id || room.currentPlayerId !== player.id) {
        return fail(callback, 'Bạn không có lượt xử lý lá +4.');
      }
      drawForPenalty(room, player, 4);
      const pendingWinner = challenge.pendingWinnerId;
      room.challenge = null;
      addMessage(room, player.name + ' chấp nhận lá +4 và rút 4 lá.');
      if (pendingWinner) finishRound(room, pendingWinner);
      else advanceAfterPenalty(room, player.id);
      emitRoom(room);
      ack(callback, { ok: true });
    });

    socket.on('uno:chat:send', (message, callback) => {
      const auth = authenticate(socket, callback);
      if (!auth) return;
      const { room, player } = auth;
      const text = clean(message, 240);
      if (!text) return fail(callback, 'Tin nhắn không được để trống.');
      const now = Date.now();
      if (player.lastMessage && now - player.lastMessage < 900) return fail(callback, 'Bạn gửi tin nhắn quá nhanh.');
      player.lastMessage = now;
      addMessage(room, text, 'chat', player.name);
      emitRoom(room);
      ack(callback, { ok: true });
    });

    socket.on('uno:game:restart', (_, callback) => {
      const auth = authenticate(socket, callback);
      if (!auth) return;
      const { room, player } = auth;
      if (room.phase !== 'ended' || player.id !== room.hostId) return fail(callback, 'Chỉ chủ phòng mới có thể bắt đầu ván mới.');
      room.phase = 'lobby';
      room.createdAt = Date.now();
      room.players.forEach(item => { item.hand = []; item.ready = item.id === room.hostId; });
      room.drawPile = [];
      room.discardPile = [];
      room.currentColor = null;
      room.currentPlayerId = null;
      room.turnDrawnCardId = null;
      room.challenge = null;
      room.pendingUno = null;
      room.winnerId = null;
      room.results = [];
      room.messages = [];
      addMessage(room, 'Chủ phòng đã tạo ván UNO mới.');
      emitRoom(room);
      ack(callback, { ok: true });
    });

    socket.on('uno:room:leave', (_, callback) => {
      const auth = authenticate(socket, callback);
      if (!auth) return;
      const { room, player } = auth;
      player.online = false;
      player.socketId = null;
      socket.data = {};
      removePlayer(room, player);
      ack(callback, { ok: true });
    });

    socket.on('disconnect', () => {
      const room = rooms.get(socket.data.roomCode);
      const player = room?.players.find(item => item.id === socket.data.playerId);
      if (player && player.socketId === socket.id) {
        player.online = false;
        player.socketId = null;
        room.lastActivity = Date.now();
        emitRoom(room);
      }
    });
  });

  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [code, room] of rooms) {
      if (room.phase === 'lobby' && now - Number(room.createdAt || now) > 4 * 60 * 60 * 1000) {
        rooms.delete(code);
        changed = true;
      }
    }
    if (changed) {
      persist();
      namespace.emit('uno:rooms-updated');
    }
  }, 60 * 1000);
  cleanupTimer.unref?.();

  return { rooms, ready: restoreRooms() };
}
