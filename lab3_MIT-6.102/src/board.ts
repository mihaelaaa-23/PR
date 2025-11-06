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
    // Map from "row,col" to array of waiting callbacks for that card
    private readonly cardWaiters: Map<string, Array<() => void>> = new Map();
    private readonly lockWaiters: Array<() => void> = [];
    private lockHeld = false;

    // Abstraction function:
    //   AF(rows, cols, grid) = a Memory Scramble game board with dimensions rows x cols,
    //     where grid[r][c] represents the spot at row r, column c
    //     Each spot contains:
    //       - card: the card string at this position (null if removed)
    //       - faceUp: true if card is currently showing, false if face-down
    //       - controller: the player ID who flipped this card (null if no controller)
    //     cardWaiters maps "row,col" keys to arrays of callbacks waiting for that card to become available
    //
    // Representation invariant:
    //   - rows > 0 and cols > 0
    //   - grid.length == rows
    //   - for all rows r: grid[r].length == cols
    //   - for all spots: if card is null, then faceUp is false and controller is null
    //   - for all spots: if card is not null, then card matches CARD_REGEX
    //   - for all spots: if controller is not null, then faceUp is true
    //   - lockHeld is true if and only if some operation currently holds the lock
    //   - lockWaiters contains callbacks waiting to acquire the lock
    //   - cardWaiters keys are valid "row,col" strings for positions on the board
    //
    // Safety from rep exposure:
    //   - rows, cols, lockHeld are immutable primitives or primitive state
    //   - grid is private and never returned directly
    //   - all methods return strings or void, never internal references
    //   - Spot objects in grid are never exposed to clients
    //   - lockWaiters, watchers, and cardWaiters are private and never returned
    //   - all public methods acquire lock before accessing mutable state
    //
    // Thread safety argument:
    //   - All public methods that access or modify the board state use acquireLock()/releaseLock()
    //   - The lock (lockHeld + lockWaiters) ensures mutual exclusion for all board operations
    //   - Lock uses promise-based waiting (not busy-waiting) via callback queue
    //   - cardWaiters provides per-card waiting: when a card becomes available (controller set to null),
    //     all waiters for that card are notified
    //   - Watchers set is protected by the lock when accessed
    //   - When lock is released, the next waiter (if any) is immediately granted the lock

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

    /**
     * Assert the representation invariant.
     */
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
                if (spot.controller !== null) {
                    assert.strictEqual(spot.faceUp, true, 'controlled card must be face up');
                }
            }
        }
    }
    
    /**
     * Get a string representation of this board.
     * @returns a string of the form "Board(RxC)" where R is the number of rows and C is the number of columns
     */
    public toString(): string {
        return `Board(${this.rows}x${this.cols})`; 
    }

    /**
     * Acquire the lock. Waits until lock is available using promise-based waiting.
     * @returns a promise that resolves when the lock is acquired
     */
    private async acquireLock(): Promise<void> {
        if (!this.lockHeld) {
            this.lockHeld = true;
            return;
        }
        
        // Lock is held, wait for it to be released
        return new Promise<void>(resolve => {
            this.lockWaiters.push(resolve);
        });
    }

    /**
     * Release the lock and notify the next waiter if any.
     */
    private releaseLock(): void {
        const nextWaiter = this.lockWaiters.shift();
        if (nextWaiter) {
            // Pass the lock to the next waiter
            nextWaiter();
        } else {
            // No one waiting, release the lock
            this.lockHeld = false;
        }
    }

    /**
     * Notify all watchers that the board has changed by calling their callback functions.
     * Clears the watcher set after notifying all watchers.
     */
    private notifyWatchers(): void {
        for (const watcher of this.watchers) {
            watcher();
        }
        this.watchers.clear();
    }

    /**
     * Notify all waiters for a specific card that the card is now available.
     * @param row the row of the card
     * @param col the column of the card
     */
    private notifyCardWaiters(row: number, col: number): void {
        const key = `${row},${col}`;
        const waiters = this.cardWaiters.get(key);
        if (waiters) {
            for (const waiter of waiters) {
                waiter();
            }
            this.cardWaiters.delete(key);
        }
    }

    /**
     * Wait for a card to become available (not controlled by anyone).
     * @param row the row of the card
     * @param col the column of the card
     * @returns a promise that resolves when the card becomes available
     */
    private waitForCard(row: number, col: number): Promise<void> {
        const key = `${row},${col}`;
        return new Promise<void>(resolve => {
            const waiters = this.cardWaiters.get(key) || [];
            waiters.push(resolve);
            this.cardWaiters.set(key, waiters);
        });
    }

    /**
     * Get the current state of the board from a specific player's perspective.
     * Shows cards controlled by the player as "my", cards controlled by others as "up" or "down",
     * and removed cards as "none".
     * 
     * @param player the player ID; must be a nonempty string
     * @returns the board state as a multi-line string in the format specified in the ps4 handout:
     *          first line is "RxC" (dimensions), followed by one line per card showing its state
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

    /**
     * Flip a card at the specified position for the given player.
     * If the card is controlled by another player and this is a first card flip, waits until it becomes available.
     * If the card is controlled by any player and this is a second card flip, fails immediately.
     * Follows the Memory Scramble game rules: players can flip at most 2 cards at a time,
     * matching pairs are removed, non-matching pairs are flipped back down.
     * 
     * @param player the player ID making the flip; must be a nonempty string
     * @param row the row index of the card to flip; must be in [0, rows)
     * @param col the column index of the card to flip; must be in [0, cols)
     * @returns a promise that resolves when the flip is complete
     * @throws Error if the coordinates are invalid, if no card exists at that position,
     *         if the player tries to flip a card they already control, or if the player
     *         already controls 2 cards, or if this is a second card flip and the target card
     *         is controlled by any player
     */
    public async flipCard(player: string, row: number, col: number): Promise<void> {
        // Keep trying until successful or error
        while (true) {
            await this.acquireLock();
            
            try {
                // First, clean up any matched pairs or non-matched pairs from previous turns
                const didCleanup = this.cleanupCompletedTurns(player);
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

                // Check how many cards this player currently controls
                let controlledCount = 0;
                for (let r = 0; r < this.rows; r++) {
                    for (let c = 0; c < this.cols; c++) {
                        const s = this.grid[r]?.[c];
                        if (s && s.controller === player && s.faceUp) {
                            controlledCount++;
                        }
                    }
                }

                // If player already has 2 cards up, they shouldn't be able to flip more
                if (controlledCount >= 2) {
                    throw new Error('cannot flip: you already control 2 cards');
                }

                // CRITICAL FIX #2: Check if this is a second card flip
                const isSecondCard = controlledCount === 1;

                // If the target card is already controlled by this player, fail
                if (spot.controller === player && spot.faceUp) {
                    throw new Error('cannot flip: card already controlled by you');
                }

                // If this is a SECOND card and the target is controlled by ANY player, fail immediately (Rule 2-B)
                if (isSecondCard && spot.controller !== null) {
                    throw new Error('cannot flip: card is controlled by another player');
                }

                // If this is a FIRST card and the card is controlled by another player, wait
                if (!isSecondCard && spot.controller !== null && spot.controller !== player) {
                    // Release lock and wait for this specific card to become available
                    const waitPromise = this.waitForCard(row, col);
                    this.releaseLock();
                    await waitPromise;
                    // Loop back to try again
                    continue;
                }

                // Flip the card
                spot.faceUp = true;
                spot.controller = player;

                // RULE 2-E FIX: If this is a second card, check for match immediately
                if (isSecondCard) {
                    // Find the first card controlled by this player
                    let firstCard: {row: number, col: number, card: string} | null = null;
                    for (let r = 0; r < this.rows; r++) {
                        for (let c = 0; c < this.cols; c++) {
                            if (r === row && c === col) continue; // Skip the card we just flipped
                            const s = this.grid[r]?.[c];
                            if (s && s.controller === player && s.faceUp && s.card) {
                                firstCard = {row: r, col: c, card: s.card};
                                break;
                            }
                        }
                        if (firstCard) break;
                    }

                    // If cards don't match, immediately relinquish control (Rule 2-E)
                    if (firstCard && firstCard.card !== spot.card) {
                        spot.controller = null;
                        const firstSpot = this.grid[firstCard.row]?.[firstCard.col];
                        if (firstSpot) {
                            firstSpot.controller = null;
                        }
                    }
                    // If they match (Rule 2-D), keep control of both cards
                }

                this.checkRep();
                this.notifyWatchers();
                
                // Success - exit the loop
                this.releaseLock();
                return;
            } catch (error) {
                // Release lock before throwing
                this.releaseLock();
                throw error;
            }
        }
    }

    /**
     * Clean up completed turns for the player who is about to make a new first card flip.
     * Checks if the player had 2 face-up cards from a previous turn.
     * If the cards match (still controlled by player), remove them from the board (Rule 3-A).
     * If they don't match (already lost control), flip them face down if not controlled (Rule 3-B).
     * 
     * UPDATED: Now handles the case where non-matching cards already lost control
     * 
     * @param player the player making the new flip
     * @returns true if any cleanup was performed, false otherwise
     */
    private cleanupCompletedTurns(player: string): boolean {
        let cleanedUp = false;
        
        // RULE 3-A: Find and remove matching cards controlled by THIS player
        const playerCards: Array<{row: number, col: number, card: string}> = [];
        
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const spot = this.grid[r]?.[c];
                if (spot && spot.controller === player && spot.faceUp && spot.card) {
                    playerCards.push({row: r, col: c, card: spot.card});
                }
            }
        }

        // If player has exactly 2 matching cards, remove them
        if (playerCards.length === 2) {
            const [card1, card2] = playerCards;
            if (card1 && card2 && card1.card === card2.card) {
                const spot1 = this.grid[card1.row]?.[card1.col];
                const spot2 = this.grid[card2.row]?.[card2.col];
                
                if (spot1 && spot2) {
                    // Match! Remove both cards
                    spot1.card = null;
                    spot1.faceUp = false;
                    spot1.controller = null;
                    spot2.card = null;
                    spot2.faceUp = false;
                    spot2.controller = null;
                    
                    // Notify any waiters for these cards
                    this.notifyCardWaiters(card1.row, card1.col);
                    this.notifyCardWaiters(card2.row, card2.col);
                    
                    cleanedUp = true;
                }
            }
        }
        
        // RULE 3-B: Flip down any face-up cards that are not controlled by anyone
        // (these are the non-matching cards from the previous turn)
        for (let r = 0; r < this.rows; r++) {
            for (let c = 0; c < this.cols; c++) {
                const spot = this.grid[r]?.[c];
                if (spot && spot.card !== null && spot.faceUp && spot.controller === null) {
                    spot.faceUp = false;
                    this.notifyCardWaiters(r, c);
                    cleanedUp = true;
                }
            }
        }
        
        return cleanedUp;
    }

    /**
     * Watch for changes to the board. Waits asynchronously until the board state changes
     * (cards turning face up/down, being removed, or changing values).
     * Uses promise-based waiting, not busy-waiting.
     * 
     * MAJOR FIX #2: Fixed race condition by getting initial state while holding the lock
     * 
     * @param player the player ID watching; must be a nonempty string
     * @returns a promise that resolves with the updated board state when the board changes
     */
    public async watch(player: string): Promise<string> {
        await this.acquireLock();
        
        try {
            // Register watcher while holding the lock to avoid race condition
            const waitPromise = new Promise<void>(resolve => {
                this.watchers.add(resolve);
            });
            
            // Release lock before waiting
            this.releaseLock();
            
            // Wait for a change
            await waitPromise;
            
            // Return the new state
            return this.renderFor(player);
        } catch (e) {
            this.releaseLock();
            throw e;
        }
    }

    /**
     * Apply a transformation function to all cards on the board.
     * Transforms all cards without affecting face-up/face-down state or control.
     * Maintains pairwise consistency: matching pairs remain matching during transformation.
     * The transformation is applied atomically per matching pair to ensure no player observes
     * a state where one card of a matching pair is transformed but not its match.
     * Other operations can interleave with map() while it's computing transformations.
     * 
     * MAJOR FIX #3: Improved pairwise consistency by applying transformations in matched pairs
     * MINOR FIX #1: Added validation for transformed cards
     * 
     * @param player the player ID performing the map
     * @param f mathematical transformation function from card to card
     * @returns the updated board state
     * @throws Error if f returns an invalid card string
     */
    public async mapCards(player: string, f: (card: string) => Promise<string>): Promise<string> {
        // First pass: collect all unique cards WITHOUT holding the lock
        await this.acquireLock();
        const uniqueCards = new Set<string>();
        try {
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    const spot = this.grid[r]?.[c];
                    if (spot && spot.card !== null) {
                        uniqueCards.add(spot.card);
                    }
                }
            }
        } finally {
            this.releaseLock();
        }
        
        // Compute all transformations WITHOUT holding the lock
        // This allows other operations to proceed while f() executes
        const transformedCards = new Map<string, string>();
        for (const card of uniqueCards) {
            const newCard = await f(card);
            
            // MINOR FIX #1: Validate the transformed card
            if (!CARD_REGEX.test(newCard)) {
                throw new Error(`invalid transformed card: "${newCard}"`);
            }
            
            transformedCards.set(card, newCard);
        }
        
        // Second pass: apply transformations atomically
        // To maintain pairwise consistency, we transform all occurrences of a card at once
        await this.acquireLock();
        try {
            for (let r = 0; r < this.rows; r++) {
                for (let c = 0; c < this.cols; c++) {
                    const spot = this.grid[r]?.[c];
                    if (spot && spot.card !== null && transformedCards.has(spot.card)) {
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

    /**
     * Get the view string for a spot from a player's perspective.
     * 
     * @param spot the spot to view
     * @param player the player ID viewing the spot
     * @returns "none" if no card, "down" if face-down, "my CARD" if controlled by player,
     *          "up CARD" if face-up and controlled by another player or no one
     */
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