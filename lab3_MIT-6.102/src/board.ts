/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import assert from 'node:assert';
import fs from 'node:fs';

/**
 * A mutable, thread-safe Memory Scramble game board.
 * Represents a rectangular grid of cards that can be flipped and matched by players.
 */

type Spot = {
    card: string | null; 
    faceUp: boolean;
    controller: string | null; // player ID of controller
}

const CARD_REGEX = /^[^\s\n\r]+$/u;

export class Board {

    private readonly rows: number;
    private readonly cols: number;
    private readonly grid: Spot[][]; //grid
    private readonly watchers: Set<() => void> = new Set();
    private readonly lock = { locked: false };

    // Abstraction function:
    //   AF(rows, cols, grid) = a Memory Scramble game board with dimensions rows x cols,
    //     where grid[r][c] represents the spot at row r, column c
    //     Each spot contains:
    //       - card: the card string at this position (null if removed)
    //       - faceUp: true if card is currently showing, false if face-down
    //       - controller: the player ID who flipped this card (null if no controller)
    //
    // Representation invariant:
    //   - rows > 0 and cols > 0
    //   - grid.length == rows
    //   - for all rows r: grid[r].length == cols
    //   - for all spots: if card is null, then faceUp is false and controller is null
    //   - for all spots: if card is not null, then card matches CARD_REGEX
    //   - for all spots: if controller is not null, then faceUp is true
    //
    // Safety from rep exposure:
    //   - rows, cols are immutable primitives
    //   - grid is private and never returned directly
    //   - all methods return strings or void, never internal references
    //   - Spot objects in grid are never exposed to clients
    //   - all public methods acquire lock before accessing mutable state

    // Thread safety argument:
    //   - All public methods that access or modify the board state use the lock
    //   - The lock ensures mutual exclusion for all board operations
    //   - Watchers set is protected by the lock when accessed

    private constructor(rows: number, cols:number, cardsRowMajor: string[]) {
        this.rows = rows;
        this.cols = cols;
        const g: Spot[][] = [];
        let i = 0;
        for (let r = 0; r < rows; r++) {
            const row: Spot[] = [];
            for (let c = 0; c < cols; c++) {
                const card = cardsRowMajor[i++] ?? null;
                row.push({
                    card,
                    faceUp: false,
                    controller: null
                });
            }
            g.push(row);
        }
        this.grid = g;;
        this.checkRep();
    }

    private checkRep(): void {
        assert.strictEqual(this.grid.length, this.rows, 'grid/rows mismatch');
        for (const row of this.grid) {
            assert.strictEqual(row.length, this.cols, 'grid/cols mismatch');
            for (const spot of row) {
                if (spot.card === null) {
                    assert.strictEqual(spot.faceUp, false, 'null card cannot be face up');
                    assert.strictEqual(spot.controller, null, 'null card cannot have controller');
                } else {
                    assert(CARD_REGEX.test(spot.card), `invalid card string: ${spot.card}`);
                }
            }
        }
    }
    
    public toString(): string {
        return `Board(${this.rows}x${this.cols})`; 
    }

    /**
     * Acquire the lock. Waits until lock is available.
     */
    private async acquireLock(): Promise<void> {
        while (this.lock.locked) {
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        this.lock.locked = true;
    }

    /**
     * Release the lock.
     */
    private releaseLock(): void {
        this.lock.locked = false;
    }

    /**
     * Notify all watchers that the board has changed.
     */
    private notifyWatchers(): void {
        for (const watcher of this.watchers) {
            watcher();
        }
        this.watchers.clear();
    }

    /**
     * Get the current state of the board for a specific player.
     * @param player the player ID
     * @returns the board state as a string
     */
    public async renderFor(player: string): Promise<string> {
        await this.acquireLock();
        try {
            const lines: string[] = [];
            lines.push(`${this.rows}x${this.cols}`);
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    const spot = this.grid[r]?.[c];
                    if (spot) {
                        lines.push(this.viewOf(spot, player));
                    }
                }
            }
            return lines.join('\n') + '\n';
        } finally {
            this.releaseLock();
        }
    }

    public async flipCard(player: string, row: number, col: number): Promise<void> {
        // Keep trying until successful or error
        while (true) {
            await this.acquireLock();
            
            try {
                // First, clean up any matched pairs or non-matched pairs from previous turns
                const didCleanup = this.cleanupCompletedTurns();
                if (didCleanup) {
                    // Notify watchers that board changed due to cleanup
                    this.notifyWatchers();
                }

                // validate coordinates
                if (row < 0 || row >= this.rows || col < 0 || col >= this.cols) {
                    throw new Error('invalid coordinates');
                }
                
                const spot = this.grid[row]?.[col];
                if (!spot || spot.card === null) {
                    throw new Error('cannot flip: no card at position');
                }

                // check if card is already controlled by this player
                if (spot.controller === player && spot.faceUp) {
                    throw new Error('cannot flip: card already controlled by you');
                }

                // Wait if card is controlled by another player
                if (spot.controller !== null && spot.controller !== player) {
                    // Release lock and wait for board to change
                    const waitPromise = new Promise<void>(resolve => {
                        this.watchers.add(resolve);
                    });
                    this.releaseLock();
                    await waitPromise;
                    // Loop back to try again
                    continue;
                }

                // Check if player already controls another card
                let controlledCount = 0;
                let firstCardRow = -1;
                let firstCardCol = -1;
                for (let r = 0; r < this.rows; r++) {
                    for (let c = 0; c < this.cols; c++) {
                        const s = this.grid[r]?.[c];
                        if (s && s.controller === player && s.faceUp) {
                            controlledCount++;
                            if (firstCardRow === -1) {
                                firstCardRow = r;
                                firstCardCol = c;
                            }
                        }
                    }
                }

                // If player already has 2 cards up, they shouldn't
                if (controlledCount >= 2) {
                    throw new Error('cannot flip: you already control 2 cards');
                }

                // Flip the card
                spot.faceUp = true;
                spot.controller = player;

                // If this is the second card, mark the result for next cleanup
                if (controlledCount === 1) {
                    const firstSpot = this.grid[firstCardRow]?.[firstCardCol];
                    if (firstSpot && firstSpot.card === spot.card) {
                        // Match! Mark both for removal (will happen on next action)
                        // For now, they stay visible
                    } else {
                        // No match - will be flipped down on next action
                    }
                }

                this.checkRep();
                this.notifyWatchers();
                
                // Success - exit the loop
                return;
            } catch (error) {
                // Release lock before throwing
                this.releaseLock();
                throw error;
            } finally {
                // Only release if we're exiting successfully
                if (this.lock.locked) {
                    this.releaseLock();
                }
            }
        }
    }

    private cleanupCompletedTurns(): boolean {
        // Find all players who have 2 cards showing
        const playerCards = new Map<string, Array<{row: number, col: number, card: string}>>();
        
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const spot = this.grid[r]?.[c];
                if (spot && spot.controller && spot.faceUp && spot.card) {
                    const cards = playerCards.get(spot.controller) || [];
                    cards.push({row: r, col: c, card: spot.card});
                    playerCards.set(spot.controller, cards);
                }
            }
        }

        let cleanedUp = false;

        // For each player with 2 cards, check if they match
        for (const [player, cards] of playerCards.entries()) {
            if (cards.length === 2) {
                const [card1, card2] = cards;
                if (card1 && card2) {
                    if (card1.card === card2.card) {
                        // Match! Remove both cards
                        const spot1 = this.grid[card1.row]?.[card1.col];
                        const spot2 = this.grid[card2.row]?.[card2.col];
                        if (spot1) {
                            spot1.card = null;
                            spot1.faceUp = false;
                            spot1.controller = null;
                        }
                        if (spot2) {
                            spot2.card = null;
                            spot2.faceUp = false;
                            spot2.controller = null;
                        }
                        cleanedUp = true;
                    } else {
                        // No match! Turn both cards face down
                        const spot1 = this.grid[card1.row]?.[card1.col];
                        const spot2 = this.grid[card2.row]?.[card2.col];
                        if (spot1) {
                            spot1.faceUp = false;
                            spot1.controller = null;
                        }
                        if (spot2) {
                            spot2.faceUp = false;
                            spot2.controller = null;
                        }
                        cleanedUp = true;
                    }
                }
            }
        }

        return cleanedUp;
    }

    /**
     * Watch for changes to the board. Waits until the board state changes.
     * @param player the player ID watching
     * @returns a promise that resolves when the board changes
     */
    public async watch(player: string): Promise<string> {
        const currentState = await this.renderFor(player);
        
        await this.acquireLock();
        try {
            // Add this watcher to be notified on next change
            await new Promise<void>(resolve => {
                this.watchers.add(resolve);
                this.releaseLock();
            });
        } catch (e) {
            this.releaseLock();
            throw e;
        }
        
        // Return the new state
        return this.renderFor(player);
    }

    /**
     * Apply a transformation function to all cards on the board.
     * @param player the player ID performing the map
     * @param f transformation function from card to card
     * @returns the updated board state
     */
    public async mapCards(player: string, f: (card: string) => Promise<string>): Promise<string> {
        await this.acquireLock();
        try {
            // Apply transformation to each card, maintaining pairs
            const transformedCards = new Map<string, string>();
            
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    const spot = this.grid[r]?.[c];
                    if (spot && spot.card !== null) {
                        // Cache transformed values to maintain consistency
                        if (!transformedCards.has(spot.card)) {
                            const newCard = await f(spot.card);
                            transformedCards.set(spot.card, newCard);
                        }
                        spot.card = transformedCards.get(spot.card) ?? spot.card;
                    }
                }
            }
            
            this.checkRep();
            this.notifyWatchers();
        } finally {
            this.releaseLock();
        }
        
        // Render after releasing the lock
        return await this.renderFor(player);
    }

    private viewOf(spot: Spot, player: string): string {
        if (spot.card === null) return 'none';
        if (!spot.faceUp) return 'down';
        if (spot.controller === player) return `my ${spot.card}`;
        return `up ${spot.card}`;
    }

    /**
     * Make a new board by parsing a file.
     * 
     * PS4 instructions: the specification of this method may not be changed.
     * 
     * @param filename path to game board file
     * @returns a new board with the size and cards from the file
     * @throws Error if the file cannot be read or is not a valid game board
     */
    public static async parseFromFile(filename: string): Promise<Board> {
        const raw = await fs.promises.readFile(filename, 'utf-8');
        const lines = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
        while (lines.length > 0 && lines[lines.length - 1] === '') {
            lines.pop();
        }
        if (lines.length === 0) {
            throw new Error('empty board file');
        }
        // first line like "3x3"
        const dims = lines[0]?.trim() ?? '';
        if (dims === '') throw new Error('missing dimension line');
        const m = /^(\d+)x(\d+)$/.exec(dims);
        if (!m || m[1] === undefined || m[2] === undefined) throw new Error(`invalid dimension line: ${dims}`);
        const rows = parseInt(m[1], 10);
        const cols = parseInt(m[2], 10);
        if (rows <= 0 || cols <= 0) {
            throw new Error('rows and cols must be positive');
        }

        const expected = rows * cols;
        const cardLines = lines.slice(1);
        if (cardLines.length !== expected) {
            throw new Error(`expected ${expected} card lines, found ${cardLines.length}`);
        }

        const cards = cardLines.map((line, idx) => {
            const card = line.trim();
            if (!CARD_REGEX.test(card)) {
                throw new Error(`invalid card on line ${idx + 2}: "${line}"`);
            }
            return card;
        });
        return new Board(rows, cols, cards);
    }
}
