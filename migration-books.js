const sqlite3 = require('sqlite3').verbose();

const dbFile = 'your_database_file.sqlite'; // Change to your actual DB file
const sourceTable = 'books';
const targetTable = 'books_migrated';

const db = new sqlite3.Database(dbFile);

db.serialize(() => {
  // 1. Get the columns of the books table
  db.all(`PRAGMA table_info(${sourceTable})`, (err, columns) => {
    if (err) throw err;

    // Build a list of column names (excluding id if you want)
    const colNames = columns.map(col => col.name);

    // 2. Create the target table if it doesn't exist (same schema)
    const colDefs = columns.map(col => `${col.name} ${col.type}`).join(', ');
    db.run(`CREATE TABLE IF NOT EXISTS ${targetTable} (${colDefs})`, (err) => {
      if (err) throw err;

      // 3. Select only complete records (no NULLs in any column)
      const notNullWhere = colNames.map(col => `${col} IS NOT NULL`).join(' AND ');
      db.all(`SELECT * FROM ${sourceTable} WHERE ${notNullWhere}`, (err, rows) => {
        if (err) throw err;

        if (rows.length === 0) {
          console.log('No complete records found.');
          db.close();
          return;
        }

        // 4. Insert complete records into the new table
        const placeholders = colNames.map(() => '?').join(', ');
        const insertStmt = db.prepare(`INSERT INTO ${targetTable} (${colNames.join(', ')}) VALUES (${placeholders})`);

        rows.forEach(row => {
          insertStmt.run(colNames.map(col => row[col]));
        });

        insertStmt.finalize(() => {
          console.log(`Migrated ${rows.length} complete book records.`);
          db.close();
        });
      });
    });
  });
});