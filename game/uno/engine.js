import { randomUUID } from 'node:crypto';

export const UNO_COLORS = Object.freeze(['red', 'yellow', 'green', 'blue']);
export const UNO_MIN_PLAYERS = 2;
export const UNO_MAX_PLAYERS = 10;

const makeCard = (color, type, value) => ({ id: randomUUID(), color, type, value });

export function createDeck() {
  const deck = [];
  for (const color of UNO_COLORS) {
    deck.push(makeCard(color, 'number', '0'));
    for (let number = 1; number <= 9; number++) {
      deck.push(makeCard(color, 'number', String(number)));
      deck.push(makeCard(color, 'number', String(number)));
    }
    for (const type of ['skip', 'reverse', 'draw2']) {
      deck.push(makeCard(color, type, type));
      deck.push(makeCard(color, type, type));
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push(makeCard(null, 'wild', 'wild'));
    deck.push(makeCard(null, 'wild4', 'wild4'));
  }
  return deck;
}

export function shuffleCards(cards) {
  const result = [...cards];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function startRound(room) {
  const deck = shuffleCards(createDeck());
  for (const player of room.players) player.hand = [];
  for (let round = 0; round < 7; round++) {
    for (const player of room.players) player.hand.push(deck.pop());
  }
  const firstNumber = deck.findIndex(card => card.type === 'number');
  if (firstNumber < 0) throw new Error('Không tìm thấy lá số để bắt đầu ván.');
  [deck[firstNumber], deck[deck.length - 1]] = [deck[deck.length - 1], deck[firstNumber]];
  room.drawPile = deck;
  room.discardPile = [room.drawPile.pop()];
  room.currentColor = room.discardPile[0].color;
  room.direction = 1;
  room.currentPlayerId = room.players[Math.floor(Math.random() * room.players.length)].id;
  room.turnDrawnCardId = null;
  room.challenge = null;
  room.pendingUno = null;
  room.winnerId = null;
  room.results = [];
  room.lastAction = 'Ván UNO bắt đầu. Mỗi người nhận 7 lá bài.';
  room.phase = 'playing';
}

export function nextPlayerId(room, fromPlayerId = room.currentPlayerId, steps = 1) {
  const count = room.players.length;
  if (!count) return null;
  const index = room.players.findIndex(player => player.id === fromPlayerId);
  if (index < 0) return room.players[0].id;
  const nextIndex = ((index + room.direction * steps) % count + count) % count;
  return room.players[nextIndex].id;
}

export function advanceTurn(room, steps = 1) {
  room.currentPlayerId = nextPlayerId(room, room.currentPlayerId, steps);
  room.turnDrawnCardId = null;
  return room.currentPlayerId;
}

export function drawCards(room, player, count = 1) {
  const drawn = [];
  for (let i = 0; i < count; i++) {
    if (!room.drawPile.length) {
      if (room.discardPile.length <= 1) break;
      const top = room.discardPile.pop();
      room.drawPile = shuffleCards(room.discardPile);
      room.discardPile = [top];
    }
    const card = room.drawPile.pop();
    if (!card) break;
    player.hand.push(card);
    drawn.push(card);
  }
  return drawn;
}

export function isPlayable(card, topCard, currentColor) {
  if (!card || !topCard) return false;
  if (card.type === 'wild' || card.type === 'wild4') return true;
  if (card.color === currentColor) return true;
  if (card.type === topCard.type && card.type !== 'number') return true;
  return card.type === 'number' && topCard.type === 'number' && card.value === topCard.value;
}

export function hasMatchingColor(hand, color) {
  return hand.some(card => card.color === color);
}

export function addMessage(room, text, type = 'system', playerName = '') {
  room.messages.push({
    id: randomUUID(),
    type,
    name: playerName,
    message: String(text).slice(0, 280),
    time: Date.now()
  });
  room.messages = room.messages.slice(-60);
}

export function finishRound(room, winnerId) {
  room.phase = 'ended';
  room.winnerId = winnerId;
  room.challenge = null;
  room.pendingUno = null;
  room.turnDrawnCardId = null;
  room.results = [...room.players]
    .map(player => ({ id: player.id, name: player.name, cardsLeft: player.hand.length }))
    .sort((a, b) => a.cardsLeft - b.cardsLeft);
  const winner = room.players.find(player => player.id === winnerId);
  addMessage(room, winner ? winner.name + ' đã chiến thắng UNO!' : 'Ván UNO đã kết thúc.');
}

export function buildPlayerView(room, playerId) {
  const self = room.players.find(player => player.id === playerId);
  if (!self) return null;
  const offender = room.challenge && room.players.find(player => player.id === room.challenge.offenderId);
  const challenger = room.challenge && room.players.find(player => player.id === room.challenge.challengerId);
  const pendingUnoPlayer = room.pendingUno && room.players.find(player => player.id === room.pendingUno.playerId);
  const currentPlayer = room.players.find(player => player.id === room.currentPlayerId);
  return {
    code: room.code,
    name: room.name,
    private: room.private,
    hostId: room.hostId,
    phase: room.phase,
    players: room.players.map(player => ({
      id: player.id,
      name: player.name,
      online: !!player.online,
      ready: !!player.ready,
      isHost: player.id === room.hostId,
      cardCount: player.hand.length
    })),
    self: { id: self.id, name: self.name, isHost: self.id === room.hostId },
    hand: [...self.hand],
    drawPileCount: room.drawPile.length,
    topCard: room.discardPile.at(-1) || null,
    currentColor: room.currentColor,
    direction: room.direction,
    currentPlayerId: room.currentPlayerId,
    currentPlayerName: currentPlayer?.name || '',
    turnDrawnCardId: room.currentPlayerId === playerId ? room.turnDrawnCardId : null,
    challenge: room.challenge ? {
      offenderId: room.challenge.offenderId,
      offenderName: offender?.name || 'Người chơi',
      challengerId: room.challenge.challengerId,
      challengerName: challenger?.name || 'Người chơi',
      previousColor: room.challenge.previousColor,
      canRespond: room.challenge.challengerId === playerId
    } : null,
    pendingUno: pendingUnoPlayer ? {
      playerId: pendingUnoPlayer.id,
      playerName: pendingUnoPlayer.name
    } : null,
    winnerId: room.winnerId,
    results: room.results || [],
    lastAction: room.lastAction || '',
    messages: room.messages.slice(-24),
    canStart: room.phase === 'lobby' && self.id === room.hostId &&
      room.players.length >= UNO_MIN_PLAYERS &&
      room.players.every(player => player.ready)
  };
}
