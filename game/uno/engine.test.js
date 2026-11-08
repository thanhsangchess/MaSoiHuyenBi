import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UNO_COLORS, createDeck, startRound, isPlayable,
  drawCards, nextPlayerId, advanceTurn
} from './engine.js';

test('Bộ bài UNO cổ điển có đúng 108 lá và đủ phân bố', () => {
  const deck = createDeck();
  assert.equal(deck.length, 108);
  assert.equal(deck.filter(card => card.type === 'wild').length, 4);
  assert.equal(deck.filter(card => card.type === 'wild4').length, 4);
  for (const color of UNO_COLORS) {
    assert.equal(deck.filter(card => card.color === color && card.value === '0').length, 1);
    for (let n = 1; n <= 9; n++) {
      assert.equal(deck.filter(card => card.color === color && card.value === String(n)).length, 2);
    }
    for (const type of ['skip', 'reverse', 'draw2']) {
      assert.equal(deck.filter(card => card.color === color && card.type === type).length, 2);
    }
  }
});

test('Mỗi người nhận 7 lá và lá đầu bàn là lá số', () => {
  const room = {
    players: [{ id: 'a', hand: [] }, { id: 'b', hand: [] }, { id: 'c', hand: [] }],
    phase: 'lobby'
  };
  startRound(room);
  assert.deepEqual(room.players.map(player => player.hand.length), [7, 7, 7]);
  assert.equal(room.drawPile.length + room.discardPile.length + room.players.reduce((sum, player) => sum + player.hand.length, 0), 108);
  assert.equal(room.discardPile[0].type, 'number');
  assert.equal(room.currentColor, room.discardPile[0].color);
  assert.ok(room.players.some(player => player.id === room.currentPlayerId));
});

test('Kiểm tra lá bài hợp lệ theo màu, số, ký hiệu và Wild', () => {
  const top = { type: 'number', value: '5', color: 'red' };
  assert.equal(isPlayable({ type: 'number', value: '8', color: 'red' }, top, 'red'), true);
  assert.equal(isPlayable({ type: 'number', value: '5', color: 'blue' }, top, 'red'), true);
  assert.equal(isPlayable({ type: 'number', value: '8', color: 'blue' }, top, 'red'), false);
  assert.equal(isPlayable({ type: 'skip', value: 'skip', color: 'blue' }, { type: 'skip', value: 'skip', color: 'red' }, 'red'), true);
  assert.equal(isPlayable({ type: 'wild', value: 'wild', color: null }, top, 'red'), true);
  assert.equal(isPlayable({ type: 'wild4', value: 'wild4', color: null }, top, 'red'), true);
});

test('Khi hết chồng bài rút, xáo lại bài đã đánh nhưng giữ lá trên cùng', () => {
  const top = { id: 'top', type: 'number', value: '3', color: 'green' };
  const room = {
    drawPile: [],
    discardPile: [top, { id: 'a', type: 'number', value: '1', color: 'red' }, { id: 'b', type: 'number', value: '2', color: 'blue' }]
  };
  const player = { hand: [] };
  const drawn = drawCards(room, player, 2);
  assert.equal(drawn.length, 2);
  assert.equal(room.discardPile.length, 1);
  assert.equal(room.discardPile[0].id, 'top');
  assert.equal(player.hand.length, 2);
});

test('Chiều chơi và số bước chuyển lượt được áp dụng đúng', () => {
  const room = {
    players: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
    currentPlayerId: 'b',
    direction: 1
  };
  assert.equal(nextPlayerId(room, 'b', 1), 'c');
  assert.equal(nextPlayerId(room, 'b', 2), 'd');
  room.direction = -1;
  assert.equal(nextPlayerId(room, 'b', 1), 'a');
  advanceTurn(room, 2);
  assert.equal(room.currentPlayerId, 'd');
});
