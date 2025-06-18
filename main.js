const { app, BrowserWindow, ipcMain } = require('electron');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const QRCode = require('qrcode');
const { spawn } = require('child_process');
const isDev = process.env.NODE_ENV === 'development';

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
    return;
}

let mainWindow;
let serverProcess;
let isServerStarted = false;

function startServer() {
    if (isServerStarted) {
        console.log('[DEBUG] Server already started');
        return;
    }

    const serverPath = isDev 
        ? path.join(__dirname, 'server.js')
        : path.join(process.resourcesPath, 'server.js');

    console.log('[DEBUG] Starting server from:', serverPath);
    console.log('[DEBUG] Current working directory:', process.cwd());
    console.log('[DEBUG] Resources path:', process.resourcesPath);

    // Kill any existing server process
    if (serverProcess) {
        serverProcess.kill();
    }

    // Set the working directory to where the server.js is located
    const workingDir = isDev ? __dirname : process.resourcesPath;

    serverProcess = spawn('node', [serverPath], {
        stdio: 'inherit',
        cwd: workingDir,
        env: {
            ...process.env,
            NODE_ENV: isDev ? 'development' : 'production',
            PORT: '5000',
            RESOURCES_PATH: process.resourcesPath
        }
    });

    serverProcess.on('error', (err) => {
        console.error('[DEBUG] Failed to start server:', err);
        isServerStarted = false;
    });

    serverProcess.on('close', (code) => {
        console.log(`[DEBUG] Server process exited with code ${code}`);
        isServerStarted = false;
    });

    // Wait for server to start
    setTimeout(() => {
        isServerStarted = true;
        if (mainWindow) {
            mainWindow.loadFile('index.html');
        }
    }, 2000);
}

// Handle second instance
app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
    }
});

// Initialize database
const db = new sqlite3.Database('student.db');

// Create users table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE,
    password TEXT,
    user_type TEXT
)`);

// Create students table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT UNIQUE,
    password TEXT,
    cellphone TEXT,
    qr_code TEXT
)`);

// Handle login requests
ipcMain.handle('login', async (event, loginData) => {
    return new Promise((resolve) => {
        const { username, password, userType } = loginData;
        
        db.get(
            'SELECT * FROM users WHERE username = ? AND user_type = ?',
            [username, userType],
            async (err, row) => {
                if (err) {
                    resolve({ success: false });
                    return;
                }

                if (row) {
                    const match = (password === row.password);
                    resolve({ success: match });
                } else {
                    resolve({ success: false });
                }
            }
        );
    });
});

// Initialize books database
//const booksDb = new sqlite3.Database('');

// Create books table if it doesn't exist
db.run(`CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ISBN TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    author TEXT NOT NULL,
    publication_year INTEGER,
    category TEXT,
    language TEXT,
    shelf_location TEXT,
    copies_available INTEGER,
    qr_code TEXT,
    number_of_page INTEGER,
    tags TEXT,
    image_url TEXT
)`);

// Add books handler
ipcMain.handle('add-book', async (event, bookData) => {
    return new Promise((resolve) => {
        const { name, author } = bookData;

        if (!name || !author) {
            resolve({ success: false, error: "Book name and author are required" });
            return;
        }

        db.run(
            'INSERT INTO books (name, author) VALUES (?, ?)',
            [name, author],
            function(err) {
                if (err) {
                    resolve({ success: false, error: err.message });
                    return;
                }

                const bookId = this.lastID;
                const qrData = JSON.stringify({
                    id: bookId,
                    name: name,
                    author: author
                });

                QRCode.toDataURL(qrData, (err, qrCodeUrl) => {
                    if (err) {
                        resolve({ success: false, error: "Failed to generate QR code" });
                        return;
                    }

                    db.run(
                        'UPDATE books SET qr_code = ? WHERE id = ?',
                        [qrCodeUrl, bookId],
                        function(err) {
                            if (err) {
                                resolve({ success: false, error: "Failed to save QR code" });
                                return;
                            }
                            resolve({ 
                                success: true, 
                                id: bookId,
                                qrCode: qrCodeUrl
                            });
                        }
                    );
                });
            }
        );
    });
});
// Add this with your other table creations
db.run(`CREATE TABLE IF NOT EXISTS borrowings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER,
    book_id INTEGER,
    borrow_date DATETIME DEFAULT CURRENT_TIMESTAMP,
    due_date DATETIME,
    return_date DATETIME,
    status TEXT DEFAULT 'borrowed',
    settled BOOLEAN DEFAULT 0,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (book_id) REFERENCES books(id)
)`);

// Add this handler for recording borrowings
ipcMain.handle('record-borrowing', async (event, borrowData) => {
    return new Promise((resolve) => {
        const { studentId, bookId } = borrowData;
        
        // Calculate due date (5 days from now)
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 5);
        
        db.run(
            'INSERT INTO borrowings (student_id, book_id, due_date) VALUES (?, ?, ?)',
            [studentId, bookId, dueDate.toISOString()],
            function(err) {
                if (err) {
                    resolve({ success: false, error: err.message });
                    return;
                }
                resolve({ success: true, id: this.lastID });
            }
        );
    });
});
// Add multiple books handler
ipcMain.handle('add-books', async (event, booksData) => {
    return new Promise((resolve) => {
        let addedCount = 0;
        let errors = [];

        const processBook = (book, callback) => {
            const { name, author, isbn, publicationYear, category, language, shelfLocation, copiesAvailable, numberOfPages, tags, image_url } = book;

            if (!name || !author) {
                errors.push("Book name and author are required");
                callback();
                return;
            }

            db.run(
                `INSERT INTO books (
                    name, 
                    author, 
                    ISBN, 
                    publication_year, 
                    category, 
                    language, 
                    shelf_location, 
                    copies_available, 
                    number_of_page,
                    tags,
                    qr_code,
                    image_url
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    name,
                    author,
                    isbn || null,
                    publicationYear || null,
                    category || null,
                    language || null,
                    shelfLocation || null,
                    copiesAvailable || null,
                    numberOfPages || null,
                    tags || null,
                    null,  // Initial QR code value
                    image_url || null  // Add image_url
                ],
                function(err) {
                    if (err) {
                        errors.push(`Error adding book "${name}": ${err.message}`);
                        callback();
                        return;
                    }

                    const bookId = this.lastID;
                    const qrData = JSON.stringify({
                        id: bookId,
                        name: name,
                        author: author
                    });

                    QRCode.toDataURL(qrData, (err, qrCodeUrl) => {
                        if (err) {
                            errors.push(`Error generating QR code for "${name}": ${err.message}`);
                            addedCount++;
                            callback();
                            return;
                        }

                        db.run(
                            'UPDATE books SET qr_code = ? WHERE id = ?',
                            [qrCodeUrl, bookId],
                            function(err) {
                                if (err) {
                                    errors.push(`Error saving QR code for "${name}": ${err.message}`);
                                }
                                addedCount++;
                                callback();
                            }
                        );
                    });
                }
            );
        };

        let remaining = booksData.length;
        booksData.forEach(book => {
            processBook(book, () => {
                remaining--;
                if (remaining === 0) {
                    resolve({ 
                        success: addedCount > 0,
                        addedCount,
                        errors: errors.length > 0 ? errors : undefined
                    });
                }
            });
        });
    });
});

// Get all books handler
ipcMain.handle('get-books', async () => {
    return new Promise((resolve) => {
        db.all('SELECT * FROM books', [], (err, rows) => {
            if (err) {
                resolve({ success: false, error: err.message });
                return;
            }
            resolve({ success: true, books: rows });
        });
    });
});

// Get all students handler
ipcMain.handle('get-students', async () => {
    return new Promise((resolve) => {
        db.all('SELECT * FROM students', [], (err, rows) => {
            if (err) {
                resolve({ success: false, error: err.message });
                return;
            }
            resolve({ success: true, students: rows });
        });
    });
});

// Add multiple students handler
ipcMain.handle('add-students', async (event, studentsData) => {
    return new Promise((resolve) => {
        let addedCount = 0;
        let errors = [];

        // Get current year
        const currentYear = new Date().getFullYear();

        // First, get the count of students for this year
        db.get('SELECT COUNT(*) as count FROM students WHERE id LIKE ?', [`${currentYear}-%`], (err, row) => {
            if (err) {
                errors.push("Failed to get student count");
                resolve({ success: false, errors });
                return;
            }

            let studentCount = row.count || 0;

            const processStudent = (student, callback) => {
                const { name, username, password, cellphone, email } = student;

                if (!name || !username || !password || !cellphone) {
                    errors.push("All student fields are required");
                    callback();
                    return;
                }

                studentCount++;
                const studentId = `${currentYear}-${String(studentCount).padStart(4, '0')}`;

                db.run(
                    'INSERT INTO students (id, name, username, password, cellphone, email) VALUES (?, ?, ?, ?, ?, ?)',
                    [studentId, name, username, password, cellphone, email],
                    function(err) {
                        if (err) {
                            errors.push(err.message);
                            callback();
                            return;
                        }

                        const qrData = JSON.stringify({
                            id: studentId
                        });

                        QRCode.toDataURL(qrData, (err, qrCodeUrl) => {
                            if (err) {
                                errors.push("Failed to generate QR code");
                                callback();
                                return;
                            }

                            db.run(
                                'UPDATE students SET qr_code = ? WHERE id = ?',
                                [qrCodeUrl, studentId],
                                function(err) {
                                    if (err) {
                                        errors.push("Failed to save QR code");
                                    } else {
                                        addedCount++;
                                        
                                        // Send password change email if email is provided
                                        if (email) {
                                            fetch('http://localhost:5000/api/send-password-change-email', {
                                                method: 'POST',
                                                headers: {
                                                    'Content-Type': 'application/json'
                                                },
                                                body: JSON.stringify({
                                                    studentId,
                                                    email,
                                                    name
                                                })
                                            }).catch(error => {
                                                console.error('Error sending password change email:', error);
                                            });
                                        }
                                    }
                                    callback();
                                }
                            );
                        });
                    }
                );
            };

            let remaining = studentsData.length;
            
            studentsData.forEach(student => {
                processStudent(student, () => {
                    remaining--;
                    if (remaining === 0) {
                        resolve({ 
                            success: addedCount > 0,
                            addedCount,
                            errors: errors.length > 0 ? errors : undefined
                        });
                    }
                });
            });
        });
    });
});

// Add this handler for getting borrowing history
ipcMain.handle('get-history', async (event) => {
    return new Promise((resolve) => {
        const query = `
            SELECT 
                b.id,
                b.student_id,
                s.name as student_name,
                b.book_id,
                bk.name as book_name,
                b.borrow_date,
                b.due_date,
                b.return_date,
                b.status,
                b.settled
            FROM borrowings b
            JOIN students s ON b.student_id = s.id
            JOIN books bk ON b.book_id = bk.id
            ORDER BY b.borrow_date DESC
        `;

        db.all(query, [], (err, rows) => {
            if (err) {
                console.error("Error fetching history:", err);
                resolve({ success: false, error: err.message });
                return;
            }

            // Format dates
            const formattedRows = rows.map(row => ({
                ...row,
                borrow_date: new Date(row.borrow_date).toISOString(),
                due_date: new Date(row.due_date).toISOString(),
                return_date: row.return_date ? new Date(row.return_date).toISOString() : null
            }));

            resolve({ success: true, history: formattedRows });
        });
    });
});

// Add update book handler
ipcMain.handle('update-book', async (event, bookData) => {
    return new Promise((resolve) => {
        const { id, shelfLocation, copiesAvailable, category, language, tags, image_url } = bookData;

        if (!id) {
            resolve({ success: false, error: "Book ID is required" });
            return;
        }

        // Determine availability
        const available = (parseInt(copiesAvailable, 10) > 0) ? 1 : 0;

        db.run(
            `UPDATE books 
             SET shelf_location = ?, 
                 copies_available = ?, 
                 category = ?, 
                 language = ?, 
                 tags = ?, 
                 image_url = ?,
                 available = ?
             WHERE id = ?`,
            [shelfLocation, copiesAvailable, category, language, tags, image_url, available, id],
            function(err) {
                if (err) {
                    console.error('Database error:', err.message);
                    resolve({ success: false, error: err.message });
                    return;
                }

                if (this.changes === 0) {
                    resolve({ success: false, error: "Book not found" });
                    return;
                }

                resolve({ success: true });
            }
        );
    });
});

// Add overdue books handler
ipcMain.handle('get-overdue-books', async () => {
    return new Promise((resolve) => {
        const db = new sqlite3.Database('student.db');
        
        db.all(`
            SELECT 
                b.id as borrow_id,
                s.id as student_id,
                s.name as student_name,
                s.username,
                bk.id as book_id,
                bk.name as book_name,
                b.borrow_date,
                b.due_date,
                b.return_date,
                b.status
            FROM borrowings b
            JOIN students s ON b.student_id = s.id
            JOIN books bk ON b.book_id = bk.id
            WHERE b.status = 'borrowed'
            AND b.due_date < CURRENT_TIMESTAMP
            ORDER BY b.due_date ASC
        `, [], (err, rows) => {
            if (err) {
                console.error('Database error:', err);
                resolve({ success: false, error: err.message });
                return;
            }
            
            // Format dates before sending
            const formattedRows = rows.map(row => ({
                ...row,
                borrow_date: new Date(row.borrow_date).toISOString(),
                due_date: new Date(row.due_date).toISOString(),
                return_date: row.return_date ? new Date(row.return_date).toISOString() : null
            }));

            resolve({ success: true, overdueBooks: formattedRows });
        });

        db.close();
    });
});

// Add this handler for updating settlement status
ipcMain.handle('update-settlement', async (event, data) => {
    return new Promise((resolve) => {
        const { borrowingId, settled } = data;
        
        db.run(
            'UPDATE borrowings SET settled = ? WHERE id = ?',
            [settled ? 1 : 0, borrowingId],
            function(err) {
                if (err) {
                    resolve({ success: false, error: err.message });
                    return;
                }
                resolve({ success: true });
            }
        );
    });
});

// Delete multiple students handler
ipcMain.handle('delete-students', async (event, studentIds) => {
    return new Promise((resolve) => {
        fetch('http://localhost:5000/api/delete-students', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ studentIds })
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                resolve({ success: false, error: data.error });
            } else {
                resolve({ success: true, message: data.message });
            }
        })
        .catch(error => {
            resolve({ success: false, error: error.message });
        });
    });
});

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        frame: false,
        autoHideMenuBar: true,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: true,
            allowRunningInsecureContent: false
        }
    });

    // Get the correct base path for resources
    const basePath = isDev ? __dirname : process.resourcesPath;

    // Load the index.html file
    mainWindow.loadFile('index.html');

    // Add error handling for failed loads
    mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
        console.error('[DEBUG] Failed to load:', errorDescription);
        if (errorCode === -102) { // CONNECTION_REFUSED
            console.log('[DEBUG] Server might not be running, attempting to restart...');
            startServer();
        }
    });

    if (isDev) {
        mainWindow.webContents.openDevTools();
    }
}

app.whenReady().then(() => {
    startServer();
    createWindow();

    app.on('activate', function () {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', function () {
    if (process.platform !== 'darwin') {
        if (serverProcess) {
            serverProcess.kill();
        }
        app.quit();
    }
});

app.on('before-quit', () => {
    if (serverProcess) {
        serverProcess.kill();
    }
});

// Window control IPC handlers
ipcMain.on('minimize-window', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window.minimize();
});
ipcMain.on('maximize-window', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }
});
ipcMain.on('close-window', (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  window.close();
});



