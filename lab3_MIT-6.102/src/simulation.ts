/* Copyright (c) 2021-25 MIT 6.102/6.031 course staff, all rights reserved.
 * Redistribution of original or derived work requires permission of course staff.
 */

import assert from 'node:assert';
import { Board } from './board.js';

/**
 * Example code for simulating a game.
 * 
 * PS4 instructions: you may use, modify, or remove this file,
 *   completing it is recommended but not required.
 * 
 * @throws Error if an error occurs reading or parsing the board
 */
async function simulationMain(): Promise<void> {
    const filename = 'boards/ab.txt';
    const board: Board = await Board.parseFromFile(filename);
    const size = 5;
    const players = 3; // Increased from 1 to 3 for multi-player simulation
    const tries = 10;
    const maxDelayMilliseconds = 100;

    console.log('Starting simulation with', players, 'players');

    // start up one or more players as concurrent asynchronous function calls
    const playerPromises: Array<Promise<void>> = [];
    for (let ii = 0; ii < players; ++ii) {
        playerPromises.push(player(ii));
    }
    // wait for all the players to finish (unless one throws an exception)
    await Promise.all(playerPromises);

    console.log('Simulation complete');

    /** @param playerNumber player to simulate */
    async function player(playerNumber: number): Promise<void> {
        const playerName = `player${playerNumber}`;
        console.log(`${playerName} starting`);

        for (let jj = 0; jj < tries; ++jj) {
            try {
                await timeout(Math.random() * maxDelayMilliseconds);
                
                // Try to flip over a first card at random position
                const row1 = randomInt(size);
                const col1 = randomInt(size);
                console.log(`${playerName} attempting first flip at (${row1}, ${col1})`);
                await board.flipCard(playerName, row1, col1);
                console.log(`${playerName} flipped first card at (${row1}, ${col1})`);

                await timeout(Math.random() * maxDelayMilliseconds);
                
                // Try to flip over a second card at random position
                const row2 = randomInt(size);
                const col2 = randomInt(size);
                console.log(`${playerName} attempting second flip at (${row2}, ${col2})`);
                await board.flipCard(playerName, row2, col2);
                console.log(`${playerName} flipped second card at (${row2}, ${col2})`);
            } catch (err) {
                console.error(`${playerName} attempt to flip a card failed:`, err);
            }
        }
        
        console.log(`${playerName} finished`);
    }
}

/**
 * Random positive integer generator
 * 
 * @param max a positive integer which is the upper bound of the generated number
 * @returns a random integer >= 0 and < max
 */
function randomInt(max: number): number {
    return Math.floor(Math.random() * max);
}


/**
 * @param milliseconds duration to wait
 * @returns a promise that fulfills no less than `milliseconds` after timeout() was called
 */
async function timeout(milliseconds: number): Promise<void> {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, milliseconds);
    return promise;
}

void simulationMain();
