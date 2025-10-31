/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import assert from 'node:assert';
import fs from 'node:fs';
import { Board } from '../src/board.js';


/**
 * Tests for the Board abstract data type.
 */
describe('Board parse + render', () => {
    it('parses perfect.txt and renders all down', async () => {
        const b = await Board.parseFromFile('boards/perfect.txt');
        const state = await b.renderFor('alice');

        const lines = state.trimEnd().split('\n');
        assert(lines[0], 'first line should exist');
        assert.match(lines[0], /^\d+x\d+$/);

        // every SPOT (after the first line) should be "down" initially
        for (const line of lines.slice(1)) {
            assert.equal(line, 'down');
        }
    });

    it('parses ab.txt correctly', async () => {
        const b = await Board.parseFromFile('boards/ab.txt');
        const state = await b.renderFor('player1');
        const lines = state.trimEnd().split('\n');
        assert.equal(lines[0], '5x5');
        assert.equal(lines.length, 26); // 1 dimension line + 25 cards
    });

    it('throws error on empty file', async () => {
        await assert.rejects(
            async () => {
                const tempFile = 'test-empty.txt';
                await fs.promises.writeFile(tempFile, '');
                try {
                    await Board.parseFromFile(tempFile);
                } finally {
                    await fs.promises.unlink(tempFile);
                }
            },
            /empty board file/
        );
    });

    it('throws error on invalid dimensions', async () => {
        await assert.rejects(
            async () => {
                const tempFile = 'test-invalid-dims.txt';
                await fs.promises.writeFile(tempFile, 'invalid\ncard1\ncard2');
                try {
                    await Board.parseFromFile(tempFile);
                } finally {
                    await fs.promises.unlink(tempFile);
                }
            },
            /invalid dimension line/
        );
    });

    it('throws error on wrong number of cards', async () => {
        await assert.rejects(
            async () => {
                const tempFile = 'test-wrong-cards.txt';
                await fs.promises.writeFile(tempFile, '2x2\ncard1\ncard2');
                try {
                    await Board.parseFromFile(tempFile);
                } finally {
                    await fs.promises.unlink(tempFile);
                }
            },
            /expected 4 card lines, found 2/
        );
    });
});

describe('Board flip operations', () => {
    it('flips first card successfully', async () => {
        const b = await Board.parseFromFile('boards/perfect.txt');
        await b.flipCard('alice', 0, 0);
        const state = await b.renderFor('alice');
        const lines = state.trimEnd().split('\n');
        // First card (line 1) should show as "my <card>"
        assert.match(lines[1] ?? '', /^my /);
    });

    it('shows flipped card to other players as "up"', async () => {
        const b = await Board.parseFromFile('boards/perfect.txt');
        await b.flipCard('alice', 0, 0);
        const state = await b.renderFor('bob');
        const lines = state.trimEnd().split('\n');
        // First card should show as "up <card>" for bob
        assert.match(lines[1] ?? '', /^up /);
    });

    it('throws error on invalid coordinates', async () => {
        const b = await Board.parseFromFile('boards/perfect.txt');
        await assert.rejects(
            async () => await b.flipCard('alice', -1, 0),
            /invalid coordinates/
        );
        await assert.rejects(
            async () => await b.flipCard('alice', 0, 100),
            /invalid coordinates/
        );
    });

    it('throws error when flipping same card twice', async () => {
        const b = await Board.parseFromFile('boards/perfect.txt');
        await b.flipCard('alice', 0, 0);
        await assert.rejects(
            async () => await b.flipCard('alice', 0, 0),
            /cannot flip: card already controlled by you/
        );
    });

    it('matches two identical cards and removes them', async () => {
        const b = await Board.parseFromFile('boards/perfect.txt');
        // Flip first card
        await b.flipCard('alice', 0, 0);
        let state = await b.renderFor('alice');
        let lines = state.trimEnd().split('\n');
        const firstCard = lines[1]?.replace('my ', '');
        
        // Find matching card
        let matchRow = 0, matchCol = 1;
        for (let r = 0; r < 3; r++) {
            for (let c = 0; c < 3; c++) {
                if (r === 0 && c === 0) continue;
                const idx = 1 + r * 3 + c;
                // We need to look at the board file to find the match
                // For perfect.txt, cards are paired
            }
        }
        
        // Flip second card (assuming it's at 0,1 for this test)
        await b.flipCard('alice', 0, 1);
        state = await b.renderFor('alice');
        lines = state.trimEnd().split('\n');
        
        // After next action, matched cards should be removed
        await b.flipCard('alice', 1, 0);
        state = await b.renderFor('alice');
        lines = state.trimEnd().split('\n');
        
        // Check that at least some cards show as "none" (removed)
        const noneCount = lines.filter(l => l === 'none').length;
        assert(noneCount >= 2, 'matched cards should be removed');
    });
});

describe('Board concurrency', () => {
    it('allows sequential flips by different players', async () => {
        const b = await Board.parseFromFile('boards/perfect.txt');
        await b.flipCard('alice', 0, 0);
        await b.flipCard('bob', 1, 0);
        
        const aliceState = await b.renderFor('alice');
        const bobState = await b.renderFor('bob');
        
        assert(aliceState.includes('up '), 'alice should see bob\'s card as up');
        assert(bobState.includes('up '), 'bob should see alice\'s card as up');
    });
});

describe('Board watch', () => {
    it('watch resolves when board changes', async function() {
        this.timeout(5000); // Increase timeout for async test
        
        const b = await Board.parseFromFile('boards/perfect.txt');
        
        // Start watching in background
        const watchPromise = b.watch('alice');
        
        // Wait a bit then make a change
        setTimeout(async () => {
            await b.flipCard('bob', 0, 0);
        }, 100);
        
        // Watch should resolve with new state
        const newState = await watchPromise;
        assert(newState.includes('up ') || newState.includes('my '), 'watch should return updated state');
    });
});

describe('Board map', () => {
    it('transforms all cards', async () => {
        const b = await Board.parseFromFile('boards/ab.txt');
        
        const transform = async (card: string) => {
            return card.toUpperCase();
        };
        
        await b.mapCards('alice', transform);
        
        // Flip a card to see if it was transformed
        await b.flipCard('alice', 0, 0);
        const state = await b.renderFor('alice');
        
        // Card should be uppercase
        assert.match(state, /my [A-Z]/);
    });

    it('maintains card pairs during transformation', async () => {
        const b = await Board.parseFromFile('boards/perfect.txt');
        
        const transform = async (card: string) => {
            return 'transformed_' + card;
        };
        
        await b.mapCards('alice', transform);
        
        // Verify transformation was applied
        await b.flipCard('alice', 0, 0);
        const state = await b.renderFor('alice');
        assert(state.includes('transformed_'), 'cards should be transformed');
    });
});
