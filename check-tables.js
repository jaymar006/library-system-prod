const sqlite3 = require('sqlite3').verbose();

// Initialize database
const db = new sqlite3.Database('student.db');

// Function to get table info
function checkTables() {
    // List of tables to check
    const tables = [
        'students',
        'books',
        'borrowings',
        'reward_redemptions',
        'deleted_students',
        'deleted_books',
        'rewards',
        'points_history',
        'users'
    ];

    tables.forEach(table => {
        console.log(`\n=== Table: ${table} ===`);
        
        // Get table structure
        db.all(`PRAGMA table_info(${table});`, (err, columns) => {
            if (err) {
                console.error(`Error getting structure for ${table}:`, err);
                return;
            }
            console.log('\nStructure:');
            columns.forEach(col => {
                console.log(`${col.name} (${col.type})`);
            });

            // Get table contents
            db.all(`SELECT * FROM ${table};`, (err, rows) => {
                if (err) {
                    console.error(`Error getting contents for ${table}:`, err);
                    return;
                }
                console.log('\nContents:');
                if (rows.length === 0) {
                    console.log('No records found');
                } else {
                    console.log(rows);
                }
            });
        });
    });

    // Close the database connection after a delay to allow all queries to complete
    setTimeout(() => {
        db.close();
    }, 2000);
}

// Execute the checking process
checkTables(); 