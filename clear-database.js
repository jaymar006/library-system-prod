const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Initialize database
const db = new sqlite3.Database('student.db');

// Function to clear all tables
function clearAllTables() {
    // Disable foreign keys temporarily
    db.run('PRAGMA foreign_keys = OFF;', (err) => {
        if (err) {
            console.error('Error disabling foreign keys:', err);
            return;
        }

        // List of tables to clear
        const tables = [
            'students',
            'books',
            'borrowings',
            'reward_redemptions',
            'deleted_students',
            'deleted_books',
            'users',
            'rewards'
        ];

        // Clear each table
        tables.forEach(table => {
            db.run(`DELETE FROM ${table};`, (err) => {
                if (err) {
                    console.error(`Error clearing table ${table}:`, err);
                } else {
                    console.log(`Successfully cleared table: ${table}`);
                }
            });
        });

        // Re-enable foreign keys
        db.run('PRAGMA foreign_keys = ON;', (err) => {
            if (err) {
                console.error('Error re-enabling foreign keys:', err);
            } else {
                console.log('Database cleared successfully!');
                // Close the database connection
                db.close();
            }
        });
    });
}

// Execute the clearing process
clearAllTables(); 