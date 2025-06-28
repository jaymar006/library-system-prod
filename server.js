console.log('[DEBUG] server.js started');
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught Exception:', err);
  process.exit(1);
});
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
// const { Pool } = require('pg');
const bodyParser = require('body-parser');
const cors = require('cors');
const QRCode = require('qrcode');
const moment = require('moment-timezone');
const nodemailer = require('nodemailer');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const schedule = require('node-schedule');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 5000;

// Function to get local IP address
function getLocalIp() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const interface of interfaces[name]) {
            // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
            if (interface.family === 'IPv4' && !interface.internal) {
                return interface.address;
            }
        }
    }
    return 'localhost'; // fallback
}

// Add this near the top of the file, after other constants
const BASE_URL = process.env.BASE_URL || `http://${getLocalIp()}:5000`;

// Create uploads directory if it doesn't exist
const uploadDir = path.join(__dirname, 'assets', 'pic', 'bookcover');
const rewardsUploadDir = path.join(__dirname, 'assets', 'pic', 'rewards');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
if (!fs.existsSync(rewardsUploadDir)) {
    fs.mkdirSync(rewardsUploadDir, { recursive: true });
}

// Configure multer for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Determine the upload directory based on the route
        const uploadPath = req.originalUrl.includes('/rewards') ? rewardsUploadDir : uploadDir;
        cb(null, uploadPath);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    },
    fileFilter: function (req, file, cb) {
        if (!file.originalname.match(/\.(jpg|jpeg|png|gif)$/)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    }
});

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname)));

// Initialize PostgreSQL database connection
// const pool = new Pool({
//     user: 'your_username',
//     host: 'your_remote_host',
//     database: 'your_database',
//     password: 'your_password',
//     port: 5000, // Default PostgreSQL port
// });
const dbPath = process.env.NODE_ENV === 'development'
    ? path.join(__dirname, 'student.db')
    : path.join(process.env.RESOURCES_PATH, 'app', 'student.db');

console.log('[DEBUG] NODE_ENV:', process.env.NODE_ENV);
console.log('[DEBUG] dbPath:', dbPath);

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error connecting to database:', err.message);
    } else {
        console.log('Connected to the SQLite database. Running the server...');
    }
});

// Drop and recreate password_resets table first
db.serialize(() => {
    db.run('DROP TABLE IF EXISTS password_resets');
    db.run(`CREATE TABLE password_resets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        user_type TEXT NOT NULL,
        token TEXT NOT NULL,
        expiry DATETIME NOT NULL,
        used INTEGER DEFAULT 0
    )`, (err) => {
        if (err) {
            console.error('Error creating password_resets table:', err);
        } else {
            console.log('Successfully created password_resets table');
        }
    });
});

// Create other tables
db.run(`
    CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        cellphone TEXT NOT NULL,
        email TEXT NOT NULL,
        points INTEGER,
        qr_code TEXT NOT NULL
    )
`);

// Add admin table
db.run(`
    CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        email TEXT NOT NULL
    )
`);

// Insert default admin if not exists
db.get('SELECT id FROM admins WHERE username = ?', ['Admin'], (err, row) => {
    if (err) {
        console.error('Error checking admin:', err);
    } else if (!row) {
        // Insert default admin
        db.run(
            'INSERT INTO admins (name, username, password, email) VALUES (?, ?, ?, ?)',
            ['Admin', 'Admin', '123', 'coclegend058@gmail.com'],
            (err) => {
                if (err) {
                    console.error('Error creating default admin:', err);
                } else {
                    console.log('Default admin created successfully');
                }
            }
        );
    }
});

db.run(`CREATE TABLE IF NOT EXISTS books (
    book_id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    image_url TEXT,
    available BOOLEAN DEFAULT 1
)`);

// Create borrowings table
db.run(`CREATE TABLE IF NOT EXISTS borrowings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL,
    book_id INTEGER NOT NULL,
    borrow_date TEXT NOT NULL,
    due_date TEXT NOT NULL,
    return_date TEXT,
    status TEXT NOT NULL,
    settled BOOLEAN DEFAULT 0,
    FOREIGN KEY (student_id) REFERENCES students(id),
    FOREIGN KEY (book_id) REFERENCES books(id)
)`);

// Create rewards and points_history tables if they don't exist
db.serialize(() => {
    // Create rewards table
    db.run(`CREATE TABLE IF NOT EXISTS rewards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        points_required INTEGER NOT NULL,
        image_url TEXT,
        item_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create points_history table
    db.run(`CREATE TABLE IF NOT EXISTS points_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        student_id TEXT NOT NULL,
        points INTEGER NOT NULL,
        description TEXT,
        date DATETIME DEFAULT CURRENT_TIMESTAMP,
        activity_type TEXT NOT NULL,
        FOREIGN KEY (student_id) REFERENCES students(id)
    )`);

    // Insert default rewards if none exist
    db.get("SELECT COUNT(*) as count FROM rewards", [], (err, row) => {
        if (err) {
            console.error('Error checking rewards:', err);
            return;
        }
        
        if (row.count === 0) {
            const defaultRewards = [
                ['Extended Borrowing Period', 'Get an extra week for book borrowing', 50, 'assets/pic/rewards/extended-borrowing.png'],
                ['Priority Access', 'Get priority access to new books', 100, 'assets/pic/rewards/priority-access.png'],
                ['Special Library Privileges', 'Access to special library events and resources', 150, 'assets/pic/rewards/special-privileges.png']
            ];
            
            const stmt = db.prepare('INSERT INTO rewards (name, description, points_required, image_url) VALUES (?, ?, ?, ?)');
            defaultRewards.forEach(reward => stmt.run(reward));
            stmt.finalize();
        }
    });
});

// Create reward_redemptions table to track reward redemptions
db.run(`
    CREATE TABLE IF NOT EXISTS reward_redemptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reward_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL,
        quantity INTEGER NOT NULL,
        redeemed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reward_id) REFERENCES rewards(id),
        FOREIGN KEY (student_id) REFERENCES students(id)
    )
`);

// Create deleted_students table
db.run(`CREATE TABLE IF NOT EXISTS deleted_students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_id INTEGER,
    name TEXT NOT NULL,
    username TEXT NOT NULL,
    password TEXT NOT NULL,
    cellphone TEXT NOT NULL,
    email TEXT NOT NULL,
    points INTEGER,
    qr_code TEXT NOT NULL,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Create deleted_books table
db.run(`CREATE TABLE IF NOT EXISTS deleted_books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_id INTEGER,
    ISBN TEXT NOT NULL,
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
    image_url TEXT,
    deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP
)`);

// Configure Nodemailer
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // true for 465, false for other ports like 587
    auth: {
        user: 'emanuelrato774@gmail.com', // PAPALITAN TO NG EMAIL (GAWA KA EMAIL FOR APP)
        pass: 'rcgg aiyu yzij tibv' // Replace this with the App Password you generated (SEARCH MO APP PASSWORDS)
    }
});

// API Endpoint to add a student
app.post('/api/students', (req, res) => {
    const { name, username, password, cellphone, email } = req.body;

    if (!name || !username || !password || !cellphone) {
        return res.status(400).json({ error: "Required fields are missing" });
    }

    // First check if username already exists
    db.get('SELECT username FROM students WHERE username = ?', [username], (err, row) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: err.message });
        }

        if (row) {
            return res.status(400).json({ error: `Username "${username}" is already taken. Please choose a different username.` });
        }

        // Get current year
        const currentYear = new Date().getFullYear();

        // Get the highest student ID for this year
        db.get('SELECT MAX(CAST(SUBSTR(id, 6) AS INTEGER)) as max_num FROM students WHERE id LIKE ?', [`${currentYear}-%`], (err, row) => {
            if (err) {
                console.error("Database error:", err.message);
                return res.status(500).json({ error: err.message });
            }

            // Generate new student ID
            const nextNum = (row.max_num || 0) + 1;
            const studentId = `${currentYear}-${String(nextNum).padStart(4, '0')}`;

            // Double check if this ID exists (race condition protection)
            db.get('SELECT id FROM students WHERE id = ?', [studentId], (err, existingId) => {
                if (err) {
                    console.error("Database error:", err.message);
                    return res.status(500).json({ error: err.message });
                }

                if (existingId) {
                    return res.status(500).json({ error: "Error generating unique student ID. Please try again." });
                }

                const query = `INSERT INTO students (id, name, username, password, cellphone, email, points) VALUES (?, ?, ?, ?, ?, ?, 0)`;
                db.run(query, [studentId, name, username, password, cellphone, email], function (err) {
                    if (err) {
                        console.error("Database error:", err.message);
                        return res.status(400).json({ error: err.message });
                    }

                    const qrData = JSON.stringify({
                        id: studentId
                    });

                    QRCode.toDataURL(qrData, (err, qrCodeUrl) => {
                        if (err) {
                            console.error("QR Code generation error:", err);
                            return res.status(500).json({ error: "Failed to generate QR code" });
                        }

                        const updateQuery = `UPDATE students SET qr_code = ? WHERE id = ?`;
                        db.run(updateQuery, [qrCodeUrl, studentId], function (err) {
                            if (err) {
                                console.error("Database update error:", err.message);
                                return res.status(400).json({ error: "Failed to save QR code to database" });
                            }

                            res.status(201).json({
                                id: studentId,
                                message: 'Student added successfully!',
                                qrCodeUrl: qrCodeUrl,
                            });
                        });
                    });
                });
            });
        });
    });
});

app.get('/api/students', (req, res) => {
    db.all(`SELECT id, name, username, cellphone, password, email, points, qr_code FROM students`, [], (err, rows) => {
        if (err) {
            res.status(400).json({ error: err.message });
        } else {
            res.status(200).json(rows);
        }
    });
});

// Login endpoint
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    // First check if it's an admin login
    db.get(
        'SELECT id, name, username, email FROM admins WHERE username = ? AND password = ?',
        [username, password],
        (err, adminRow) => {
            if (err) {
                res.status(500).json({ success: false, message: 'Database error' });
                return;
            }

            if (adminRow) {
                res.json({ 
                    success: true, 
                    redirect: 'admindashboard.html',
                    userData: {
                        id: adminRow.id,
                        name: adminRow.name,
                        username: adminRow.username,
                        email: adminRow.email,
                        role: 'admin'
                    }
                });
                return;
            }

            // If not admin, check student database
            db.get(
                'SELECT id, name, username, points FROM students WHERE username = ? AND password = ?',
                [username, password],
                (err, studentRow) => {
                    if (err) {
                        res.status(500).json({ success: false, message: 'Database error' });
                        return;
                    }

                    if (studentRow) {
                        res.json({ 
                            success: true, 
                            redirect: 'studentdashboard.html',
                            userData: {
                                id: studentRow.id,
                                name: studentRow.name,
                                username: studentRow.username,
                                points: studentRow.points,
                                role: 'student'
                            }
                        });
                    } else {
                        res.json({ success: false, message: 'Invalid credentials' });
                    }
                }
            );
        }
    );
});

// Modify the books endpoint to handle file upload
app.post('/api/books', upload.single('image'), (req, res) => {
    const { name, author, isbn, publicationYear, category, language, shelfLocation, copiesAvailable, numberOfPages, tags } = req.body;

    if (!name || !author) {
        return res.status(400).json({ error: "Book name and author are required" });
    }

    // Get the image URL if a file was uploaded
    const imageUrl = req.file ? `/assets/pic/bookcover/${req.file.filename}` : null;

    // Determine availability
    const available = (parseInt(copiesAvailable, 10) > 0) ? 1 : 0;

    // First insert the book without QR code
    const query = `INSERT INTO books (
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
        image_url,
        available
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    
    db.run(query, [
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
        imageUrl,
        available
    ], function(err) {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(400).json({ error: err.message });
        }

        const bookId = this.lastID;
        const qrData = JSON.stringify({
            id: bookId,
            name: name,
            author: author
        });

        // Generate QR code
        QRCode.toDataURL(qrData, (err, qrCodeUrl) => {
            if (err) {
                console.error("QR Code generation error:", err);
                return res.status(500).json({ error: "Failed to generate QR code" });
            }

            // Update the book with the QR code
            const updateQuery = `UPDATE books SET qr_code = ? WHERE id = ?`;
            db.run(updateQuery, [qrCodeUrl, bookId], function(err) {
                if (err) {
                    console.error("Database update error:", err.message);
                    return res.status(400).json({ error: "Failed to save QR code to database" });
                }

                res.status(201).json({
                    id: bookId,
                    message: 'Book added successfully!',
                    qrCodeUrl: qrCodeUrl,
                    imageUrl: imageUrl
                });
            });
        });
    });
});

// app.get('/api/books', (req, res) => {
//     booksDb.all(`SELECT id, name, author, qr_code FROM books`, [], (err, rows) => {
//         if (err) {
//             res.status(400).json({ error: err.message });
//         } else {
//             res.status(200).json(rows);
//         }
//     });
// });

// Add this endpoint to server.js
app.get('/api/history', (req, res) => {
    // Updated SQL query to join with students and books tables
    const db = new sqlite3.Database(dbPath);
    db.all(`
        SELECT 
            b.id,
            b.student_id,
            s.name as student_name,
            s.username,
            b.book_id,
            bk.name as book_name,
            b.borrow_date,
            b.due_date,
            b.return_date,
            b.status,
            b.settled
        FROM borrowings b
        LEFT JOIN students s ON b.student_id = s.id
        LEFT JOIN books bk ON b.book_id = bk.id
        ORDER BY b.borrow_date DESC
    `, [], (err, rows) => {
        if (err) {
            res.status(400).json({ error: err.message });
        } else {
            res.status(200).json(rows);
        }
    });

    db.close();
});

// Add this endpoint to fetch dashboard data
app.get('/api/dashboard', async (req, res) => {
    try {
        const totalStudents = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) AS count FROM students', [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const totalBooks = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) AS count FROM books', [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const totalBorrowedBooks = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) AS count FROM borrowings WHERE settled = 0', [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const returnedBooks = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) AS count FROM borrowings WHERE settled = 1', [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        const pendingBooks = await new Promise((resolve, reject) => {
            db.get('SELECT COUNT(*) AS count FROM borrowings WHERE settled = 0', [], (err, row) => {
                if (err) reject(err);
                else resolve(row.count);
            });
        });

        res.json({
            totalStudents,
            totalBooks,
            totalBorrowedBooks,
            returnedBooks,
            pendingBooks,
        });
    } catch (error) {
        console.error('Error fetching dashboard data:', error);
        res.status(500).send('Internal Server Error');
    }
});

// API Endpoint to delete a student by ID or name
app.delete('/api/students/:idOrName', (req, res) => {
    const { idOrName } = req.params;

    // Start a transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // First get the student data
        const getQuery = idOrName.includes('-') 
            ? `SELECT * FROM students WHERE id = ?` 
            : `SELECT * FROM students WHERE name = ?`;

        db.get(getQuery, [idOrName], (err, student) => {
            if (err) {
                db.run('ROLLBACK');
                console.error("Database error:", err.message);
                return res.status(400).json({ error: "Failed to get student data" });
            }

            if (!student) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: "Student not found" });
            }

            // Insert into deleted_students
            const insertQuery = `
                INSERT INTO deleted_students (
                    original_id, name, username, password, 
                    cellphone, email, points, qr_code
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.run(insertQuery, [
                student.id,
                student.name,
                student.username,
                student.password,
                student.cellphone,
                student.email,
                student.points,
                student.qr_code
            ], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error("Database error:", err.message);
                    return res.status(400).json({ error: "Failed to archive student" });
                }

                // Delete from students table
                const deleteQuery = `DELETE FROM students WHERE id = ?`;
                db.run(deleteQuery, [student.id], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        console.error("Database error:", err.message);
                        return res.status(400).json({ error: "Failed to delete student" });
                    }

                    db.run('COMMIT');
                    res.status(200).json({ 
                        message: "Student archived successfully!",
                        archivedId: this.lastID 
                    });
                });
            });
        });
    });
});

// Add endpoint to check borrowing status
app.get('/api/borrowings/check', (req, res) => {
    const { studentId, bookId } = req.query;

    if (!studentId || !bookId) {
        return res.status(400).json({ error: "Student ID and Book ID are required" });
    }

    const query = `
        SELECT b.*, s.name as student_name, bk.name as book_name
        FROM borrowings b
        JOIN students s ON b.student_id = s.id
        JOIN books bk ON b.book_id = bk.id
        WHERE b.student_id = ? AND b.book_id = ? AND b.settled = 0
        ORDER BY b.borrow_date DESC
        LIMIT 1
    `;

    db.get(query, [studentId, bookId], (err, row) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        if (!row) {
            return res.json({ success: false, message: "No active borrowing found" });
        }

        res.json({
            success: true,
            borrowing: {
                id: row.id,
                student_id: row.student_id,
                student_name: row.student_name,
                book_id: row.book_id,
                book_name: row.book_name,
                borrow_date: row.borrow_date,
                due_date: row.due_date,
                status: row.status
            }
        });
    });
});

// Modify the getCurrentPhilippineTime function
function getCurrentPhilippineTime() {
    // Get current time in Asia/Manila timezone
    const philippineTime = moment().tz('Asia/Manila');
    // Format in SQLite datetime format (YYYY-MM-DD HH:MM:SS)
    return philippineTime.format('YYYY-MM-DD HH:mm:ss');
}

// Add this function after the getCurrentPhilippineTime function
function checkDueBooksAndSendNotifications() {
    const today = moment().tz('Asia/Manila').format('YYYY-MM-DD');
    
    // Query for both due today and overdue books
    const query = `
        SELECT 
            b.id as borrow_id,
            s.id as student_id,
            s.name as student_name,
            s.email as student_email,
            bk.name as book_name,
            b.due_date,
            CASE 
                WHEN date(b.due_date) < date('now') THEN 'overdue'
                ELSE 'due today'
            END as status
        FROM borrowings b
        JOIN students s ON b.student_id = s.id
        JOIN books bk ON b.book_id = bk.id
        WHERE b.return_date IS NULL
        AND (
            date(b.due_date) = date('now') OR 
            date(b.due_date) < date('now')
        )
    `;

    console.log("Checking for due and overdue books...");
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Error checking due books:", err);
            return;
        }

        console.log(`Found ${rows.length} due/overdue books`);
        
        if (rows.length === 0) {
            console.log("No due or overdue books found");
            return;
        }

        rows.forEach(row => {
            const status = row.status === 'overdue' ? 'Overdue' : 'Due Today';
            const mailOptions = {
                from: 'emanuelrato774@gmail.com',
                to: row.student_email,
                subject: `Book ${status} - Library Management System`,
                html: `
                    <h2>Book ${status}</h2>
                    <p>Dear ${row.student_name},</p>
                    <p>This is a reminder that your book "${row.book_name}" is ${status.toLowerCase()}.</p>
                    <p>Please return the book to the library as soon as possible to avoid any late fees.</p>
                    <p>Thank you for your cooperation!</p>
                    <p>Best regards,<br>Library Management System</p>
                `
            };

            console.log(`Sending email to ${row.student_email} for book "${row.book_name}"`);
            
            transporter.sendMail(mailOptions, function(error, info) {
                if (error) {
                    console.error('Error sending email:', error);
                } else {
                    console.log('Due date notification sent:', info.response);
                }
            });
        });
    });
}

// Add this after the app.listen call
// Check for due books every day at 9:00 AM
schedule.scheduleJob('0 9 * * *', function() {
    console.log("Running scheduled check for due books");
    checkDueBooksAndSendNotifications();
});

// Also run it once when the server starts
console.log("Running initial check for due books");
checkDueBooksAndSendNotifications();

// Modify the return endpoint to handle settlement
app.post('/api/return', (req, res) => {
    const { studentId, bookId, borrowingId, status } = req.body;

    if (!studentId || !bookId || !borrowingId) {
        return res.status(400).json({ error: "Student ID, Book ID, and Borrowing ID are required" });
    }

    const currentTime = getCurrentPhilippineTime();
    const returnStatus = status || 'returned'; // Default to 'returned' if no status provided
    const isSettled = (returnStatus === 'returned') ? 1 : 0; // Only mark as settled if status is 'returned'

    // Start a transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Get borrowing details first
        const getBorrowingQuery = `
            SELECT borrow_date, due_date
            FROM borrowings
            WHERE id = ? AND student_id = ? AND book_id = ? AND return_date IS NULL
        `;

        db.get(getBorrowingQuery, [borrowingId, studentId, bookId], (err, borrowing) => {
            if (err) {
                db.run('ROLLBACK');
                console.error("Database error:", err.message);
                return res.status(500).json({ error: "Database error" });
            }

            if (!borrowing) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: "No active borrowing found" });
            }

            // Calculate points based on return time and status
            let pointsToAdd = 0;
            const borrowDate = new Date(borrowing.borrow_date);
            const dueDate = new Date(borrowing.due_date);
            const returnDate = new Date(currentTime);
            const daysBorrowed = Math.floor((returnDate - borrowDate) / (1000 * 60 * 60 * 24));
            const daysLate = Math.floor((returnDate - dueDate) / (1000 * 60 * 60 * 24));

            // Adjust points based on return status
            if (returnStatus === 'return w/ damage') {
                pointsToAdd = -20; // Penalty for damaged return
            } else if (returnStatus === 'lost') {
                pointsToAdd = -40; // Penalty for lost book
            } else if (daysBorrowed < 2) {
                pointsToAdd = 0; // Minimum borrow time not met
            } else if (daysLate > 0) {
                // Maximum penalty of -20 points (10 days late)
                const maxPenaltyDays = 10;
                const penaltyPerDay = -2;
                const calculatedPenalty = penaltyPerDay * Math.min(daysLate, maxPenaltyDays);
                pointsToAdd = calculatedPenalty;
            } else {
                pointsToAdd = 15; // Early return bonus
            }

            // Update borrowing record with return date, status, and settled flag
            const updateBorrowingQuery = `
                UPDATE borrowings 
                SET return_date = ?,
                    status = ?,
                    settled = ?
                WHERE id = ? AND student_id = ? AND book_id = ? AND return_date IS NULL
            `;

            db.run(updateBorrowingQuery, [currentTime, returnStatus, isSettled, borrowingId, studentId, bookId], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error("Database error:", err.message);
                    return res.status(500).json({ error: "Database error" });
                }

                if (this.changes === 0) {
                    db.run('ROLLBACK');
                    return res.status(400).json({ error: "Book has already been returned" });
                }

                // Increase available copies and update available flag based on new value
                db.run(
                    'UPDATE books SET copies_available = copies_available + 1 WHERE id = ?',
                    [bookId],
                    function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            console.error("Database error:", err.message);
                            return res.status(500).json({ error: "Database error" });
                        }

                        // Now update the available flag based on the new copies_available
                        db.get('SELECT copies_available FROM books WHERE id = ?', [bookId], function(err, row) {
                            if (err) {
                                db.run('ROLLBACK');
                                console.error("Database error:", err.message);
                                return res.status(500).json({ error: "Database error" });
                            }
                            const availableValue = (row && row.copies_available > 0) ? 1 : 0;
                            db.run('UPDATE books SET available = ? WHERE id = ?', [availableValue, bookId], function(err) {
                                if (err) {
                                    db.run('ROLLBACK');
                                    console.error("Database error:", err.message);
                                    return res.status(500).json({ error: "Database error" });
                                }

                                // Update student points
                                const updatePointsQuery = `
                                    UPDATE students 
                                    SET points = COALESCE(points, 0) + ?
                                    WHERE id = ?
                                `;

                                db.run(updatePointsQuery, [pointsToAdd, studentId], function(err) {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        console.error("Database error:", err.message);
                                        return res.status(500).json({ error: "Database error" });
                                    }

                                    // Insert into points_history
                                    db.get('SELECT name FROM books WHERE id = ?', [bookId], function(err, bookRow) {
                                        if (err) {
                                            db.run('ROLLBACK');
                                            console.error("Database error:", err.message);
                                            return res.status(500).json({ error: "Database error" });
                                        }
                                        const description = `Book returned: ${bookRow ? bookRow.name : 'Unknown Book'}`;
                                        db.run(
                                            'INSERT INTO points_history (student_id, points, description, date, activity_type) VALUES (?, ?, ?, datetime("now"), "return")',
                                            [studentId, pointsToAdd, description],
                                            function(err) {
                                                if (err) {
                                                    db.run('ROLLBACK');
                                                    console.error("Database error:", err.message);
                                                    return res.status(500).json({ error: "Database error" });
                                                }

                                                db.run('COMMIT');

                                                // Add warning message for one week overdue
                                                let warningMessage = "";
                                                if (daysLate >= 7) {
                                                    warningMessage = "Warning: Book was overdue for more than a week. Please be more careful with due dates.";
                                                }

                                                res.json({
                                                    success: true,
                                                    message: "Book returned successfully",
                                                    pointsAwarded: pointsToAdd,
                                                    status: returnStatus,
                                                    warning: warningMessage,
                                                    daysLate: daysLate,
                                                    settled: isSettled
                                                });
                                            }
                                        );
                                    });
                                });
                            });
                        });
                    }
                );
            });
        });
    });
});

// Add endpoint to update settlement status
app.post('/api/update-settlement', async (req, res) => {
    const { borrowingId, settled } = req.body;

    if (!borrowingId || settled === undefined) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    try {
        const query = `
            UPDATE borrowings 
            SET settled = ? 
            WHERE id = ?
        `;
        
        await db.run(query, [settled ? 1 : 0, borrowingId]);
        
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating settlement status:', error);
        res.status(500).json({ success: false, error: 'Failed to update settlement status' });
    }
});

// Borrow a book
app.post('/api/borrow-book', (req, res) => {
    const { studentId, bookId } = req.body;
    
    if (!studentId || !bookId) {
        return res.status(400).json({ success: false, message: 'Student ID and Book ID are required' });
    }

    // Start a transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // First check if the book has available copies
        db.get('SELECT copies_available FROM books WHERE id = ?', [bookId], (err, book) => {
            if (err) {
                db.run('ROLLBACK');
                console.error('Database error:', err);
                return res.status(500).json({ success: false, message: 'Database error' });
            }

            if (!book) {
                db.run('ROLLBACK');
                return res.status(404).json({ success: false, message: 'Book not found' });
            }

            if (book.copies_available <= 0) {
                db.run('ROLLBACK');
                return res.status(400).json({ success: false, message: 'No copies available for this book' });
            }

            // Check if the student has any active borrowings of this book
            db.get(
                'SELECT * FROM borrowings WHERE student_id = ? AND book_id = ? AND settled = 0',
                [studentId, bookId],
                (err, existingBorrowing) => {
                    if (err) {
                        db.run('ROLLBACK');
                        console.error('Database error:', err);
                        return res.status(500).json({ success: false, message: 'Database error' });
                    }

                    if (existingBorrowing) {
                        db.run('ROLLBACK');
                        return res.status(400).json({ 
                            success: false, 
                            message: 'You already have an active borrowing of this book. Please return it first.' 
                        });
                    }

                    // Get current Philippine time
                    const currentTime = moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss');
                    
                    // Calculate due date (5 days from now) in Philippine time
                    const dueDate = moment().tz('Asia/Manila').add(5, 'days').format('YYYY-MM-DD HH:mm:ss');

                    // Decrease available copies and update available flag
                    db.run(
                        'UPDATE books SET copies_available = copies_available - 1, available = CASE WHEN copies_available - 1 > 0 THEN 1 ELSE 0 END WHERE id = ?',
                        [bookId],
                        function(err) {
                            if (err) {
                                db.run('ROLLBACK');
                                console.error('Database error:', err);
                                return res.status(500).json({ success: false, message: 'Database error' });
                            }

                            // Create the borrowing record
                            db.run(
                                'INSERT INTO borrowings (student_id, book_id, borrow_date, due_date, status) VALUES (?, ?, ?, ?, ?)',
                                [studentId, bookId, currentTime, dueDate, 'borrowed'],
                                function(err) {
                                    if (err) {
                                        db.run('ROLLBACK');
                                        console.error('Database error:', err);
                                        return res.status(500).json({ success: false, message: 'Database error' });
                                    }

                                    db.run('COMMIT');
                                    res.json({ success: true, message: 'Book borrowed successfully' });
                                }
                            );
                        }
                    );
                }
            );
        });
    });
});

// Update forgot password endpoint
app.post('/api/forgot-password', (req, res) => {
    const { email } = req.body;

    if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
    }

    // First check if email exists in admin table
    db.get('SELECT id FROM admins WHERE email = ?', [email], (err, adminRow) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, error: 'Database error' });
        }

        if (adminRow) {
            // Generate reset token
            const token = require('crypto').randomBytes(32).toString('hex');
            const expiry = new Date(Date.now() + 3 * 24 * 3600000); // 3 days from now

            // Store reset token in database
            db.run(
                'INSERT INTO password_resets (user_id, user_type, token, expiry) VALUES (?, ?, ?, ?)',
                [adminRow.id, 'admin', token, expiry.toISOString()],
                function(err) {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ success: false, error: 'Failed to store reset token' });
                    }

                    // Create reset link
                    const resetLink = `${BASE_URL}/reset-password.html?token=${token}`;

                    // Email content
                    const mailOptions = {
                        from: 'emanuelrato774@gmail.com',
                        to: email,
                        subject: 'Password Reset Request - Admin Account',
                        html: `
                            <h2>Password Reset Request</h2>
                            <p>You have requested to reset your admin account password. Click the link below to reset it:</p>
                            <p><a href="${resetLink}">${resetLink}</a></p>
                            <p>If you didn't request this, please ignore this email.</p>
                            <p>This link will expire in 3 days.</p>
                            <p>Best regards,<br>Library Management System</p>
                        `
                    };

                    // Send email
                    transporter.sendMail(mailOptions, function(error, info) {
                        if (error) {
                            console.error('Email error:', error);
                            return res.status(500).json({ 
                                success: false, 
                                error: 'Failed to send email',
                                details: error.message 
                            });
                        }
                        console.log('Email sent:', info.response);
                        res.json({ 
                            success: true, 
                            message: 'Password reset instructions sent to your email'
                        });
                    });
                }
            );
            return;
        }

        // If not found in admin table, check student table
        db.get('SELECT id FROM students WHERE email = ?', [email], (err, studentRow) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ success: false, error: 'Database error' });
            }

            if (!studentRow) {
                return res.status(404).json({ success: false, error: 'Email not found' });
            }

            // Generate reset token
            const token = require('crypto').randomBytes(32).toString('hex');
            const expiry = new Date(Date.now() + 3 * 24 * 3600000); // 3 days from now

            // Store reset token in database
            db.run(
                'INSERT INTO password_resets (user_id, user_type, token, expiry) VALUES (?, ?, ?, ?)',
                [studentRow.id, 'student', token, expiry.toISOString()],
                function(err) {
                    if (err) {
                        console.error('Database error:', err);
                        return res.status(500).json({ success: false, error: 'Failed to store reset token' });
                    }

                    // Create reset link
                    const resetLink = `${BASE_URL}/reset-password.html?token=${token}`;

                    // Email content
                    const mailOptions = {
                        from: 'emanuelrato774@gmail.com',
                        to: email,
                        subject: 'Password Reset Request - Student Account',
                        html: `
                            <h2>Password Reset Request</h2>
                            <p>You have requested to reset your student account password. Click the link below to reset it:</p>
                            <p><a href="${resetLink}">${resetLink}</a></p>
                            <p>If you didn't request this, please ignore this email.</p>
                            <p>This link will expire in 3 days.</p>
                            <p>Best regards,<br>Library Management System</p>
                        `
                    };

                    // Send email
                    transporter.sendMail(mailOptions, function(error, info) {
                        if (error) {
                            console.error('Email error:', error);
                            return res.status(500).json({ 
                                success: false, 
                                error: 'Failed to send email',
                                details: error.message 
                            });
                        }
                        console.log('Email sent:', info.response);
                        res.json({ 
                            success: true, 
                            message: 'Password reset instructions sent to your email'
                        });
                    });
                }
            );
        });
    });
});

// Update reset password endpoint
app.post('/api/reset-password', (req, res) => {
    const { token, password } = req.body;

    if (!token || !password) {
        return res.status(400).json({ success: false, error: 'Token and password are required' });
    }

    // Verify token and check expiry
    db.get(
        'SELECT user_id, user_type FROM password_resets WHERE token = ? AND expiry > datetime("now") AND used = 0',
        [token],
        (err, row) => {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ success: false, error: 'Database error' });
            }

            if (!row) {
                return res.status(400).json({ success: false, error: 'Invalid or expired reset token' });
            }

            // Update password based on user type
            const updateQuery = row.user_type === 'admin' 
                ? 'UPDATE admins SET password = ? WHERE id = ?'
                : 'UPDATE students SET password = ? WHERE id = ?';

            db.run(updateQuery, [password, row.user_id], function(err) {
                if (err) {
                    console.error('Database error:', err);
                    return res.status(500).json({ success: false, error: 'Failed to update password' });
                }

                // Mark token as used
                db.run(
                    'UPDATE password_resets SET used = 1 WHERE token = ?',
                    [token],
                    function(err) {
                        if (err) {
                            console.error('Database error:', err);
                        }
                        res.json({ success: true, message: 'Password has been reset successfully' });
                    }
                );
            });
        }
    );
});

function searchStudents() {
    const input = document.getElementById('studentSearch').value.toLowerCase();
    const rows = document.querySelectorAll('.student-table tbody tr');

    rows.forEach(row => {
        const name = row.cells[1].textContent.toLowerCase(); // Assuming the name is in the second column
        row.style.display = name.includes(input) ? '' : 'none';
    });
}

function searchBooks() {
    const input = document.getElementById('bookSearch').value.toLowerCase();
    const rows = document.querySelectorAll('.books-table tbody tr');

    rows.forEach(row => {
        const name = row.cells[1].textContent.toLowerCase(); // Assuming the name is in the second column
        row.style.display = name.includes(input) ? '' : 'none';
    });
}

// Add endpoint for student-specific borrowing history
app.get('/api/student/history/:studentId', (req, res) => {
    const { studentId } = req.params;
    const { filter } = req.query;

    if (!studentId) {
        return res.status(400).json({ error: "Student ID is required" });
    }

    let query = `
        SELECT 
            b.id,
            b.student_id,
            bk.name as bookTitle,
            b.borrow_date as borrowDate,
            b.due_date as dueDate,
            b.return_date as returnDate,
            b.status
        FROM borrowings b
        JOIN books bk ON b.book_id = bk.id
        WHERE b.student_id = ?
    `;

    // Apply filter if specified
    switch (filter) {
        case 'borrowed':
            query += " AND b.settled = 0";
            break;
        case 'returned':
            query += " AND b.settled = 1";
            break;
        case 'pending':
            query += " AND b.settled = 0 AND b.due_date < datetime('now')";
            break;
    }

    query += " ORDER BY b.borrow_date DESC";

    db.all(query, [studentId], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        // Format dates before sending
        const formattedRows = rows.map(row => ({
            ...row,
            borrowDate: new Date(row.borrowDate).toISOString(),
            dueDate: row.dueDate ? new Date(row.dueDate).toISOString() : null,
            returnDate: row.returnDate ? new Date(row.returnDate).toISOString() : null
        }));

        res.json(formattedRows);
    });
});

// Add endpoint for student dashboard data
app.get('/api/student/dashboard/:studentId', (req, res) => {
    const { studentId } = req.params;

    if (!studentId) {
        return res.status(400).json({ error: "Student ID is required" });
    }

    // Get counts for different borrowing statuses
    const query = `
        SELECT 
            COUNT(CASE WHEN return_date IS NULL THEN 1 END) as borrowedCount,
            COUNT(CASE WHEN return_date IS NOT NULL THEN 1 END) as returnedCount,
            COUNT(CASE WHEN return_date IS NULL AND due_date < datetime('now') THEN 1 END) as pendingCount
        FROM borrowings
        WHERE student_id = ?
    `;

    db.get(query, [studentId], (err, row) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        // For now, we'll set points to 0 since points system is not implemented
        const dashboardData = {
            borrowedCount: row.borrowedCount || 0,
            returnedCount: row.returnedCount || 0,
            pendingCount: row.pendingCount || 0,
            points: 0,
            readingTrend: {
                labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
                values: [0, 0, 0, 0, 0, 0]
            }
        };

        res.json(dashboardData);
    });
});

// Modify the points calculation logic in the student points endpoint
app.get('/api/student/points/:studentId', (req, res) => {
    const { studentId } = req.params;

    if (!studentId) {
        return res.status(400).json({ error: "Student ID is required" });
    }

    // Get student's current points
    db.get('SELECT points FROM students WHERE id = ?', [studentId], (err, student) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        // Get points history from borrowings
        const query = `
            SELECT 
                b.borrow_date as date,
                CASE 
                    WHEN b.return_date IS NULL THEN 'Book borrowed'
                    WHEN b.return_date > b.due_date THEN 'Late return'
                    WHEN JULIANDAY(b.return_date) - JULIANDAY(b.borrow_date) <= 2 THEN 'Early return (1-2 days)'
                    ELSE 'On-time return (3-4 days)'
                END as activity,
                CASE 
                    WHEN b.return_date IS NULL THEN 0  -- No points for borrowed books
                    WHEN b.return_date > b.due_date THEN 2  -- 2 points for late return (10 - 8 penalty)
                    WHEN JULIANDAY(b.return_date) - JULIANDAY(b.borrow_date) <= 2 THEN 0  -- No points for early return (1-2 days)
                    ELSE 10  -- Full 10 points for on-time return (3-4 days)
                END as points
            FROM borrowings b
            WHERE b.student_id = ?
            ORDER BY b.borrow_date DESC
        `;

        db.all(query, [studentId], (err, rows) => {
            if (err) {
                console.error("Database error:", err.message);
                return res.status(500).json({ error: "Database error" });
            }

            // Format dates and calculate total points
            const history = rows.map(row => ({
                date: new Date(row.date).toISOString(),
                activity: row.activity,
                points: row.points
            }));

            const totalPoints = student.points || 0;

            res.json({
                points: totalPoints,
                history: history
            });
        });
    });
});

// Add endpoint for recommended books
app.get('/api/student/recommended/:studentId', (req, res) => {
    const { studentId } = req.params;

    if (!studentId) {
        return res.status(400).json({ error: "Student ID is required" });
    }

    // First, get the tags of books the student has borrowed
    const getStudentTagsQuery = `
        SELECT DISTINCT b.tags
        FROM borrowings br
        JOIN books b ON br.book_id = b.id
        WHERE br.student_id = ? AND b.tags IS NOT NULL
    `;

    db.all(getStudentTagsQuery, [studentId], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        // Extract all tags from the student's borrowed books
        const studentTags = new Set();
        rows.forEach(row => {
            if (row.tags) {
                const tags = row.tags.split(',').map(tag => tag.trim());
                tags.forEach(tag => studentTags.add(tag));
            }
        });

        // If no tags found, return popular books instead
        if (studentTags.size === 0) {
            const popularBooksQuery = `
                SELECT DISTINCT 
                    b.id, 
                    b.name as title, 
                    b.author,
                    b.image_url,
                    (SELECT COUNT(*) FROM borrowings WHERE book_id = b.id) as borrow_count
                FROM books b
                JOIN borrowings br ON b.id = br.book_id
                WHERE br.student_id != ?
                ORDER BY borrow_count DESC
                LIMIT 6
            `;

            db.all(popularBooksQuery, [studentId], (err, rows) => {
                if (err) {
                    console.error("Database error:", err.message);
                    return res.status(500).json({ error: "Database error" });
                }

                const recommendedBooks = rows.map(book => ({
                    id: book.id,
                    title: book.title,
                    author: book.author,
                    image_url: book.image_url || '/assets/pic/default-book.jpg',
                    rating: 4.5 // Default rating
                }));

                res.json(recommendedBooks);
            });
            return;
        }

        // Create a query to find books with matching tags
        const tagsArray = Array.from(studentTags);
        const placeholders = tagsArray.map(() => '?').join(',');
        const recommendedBooksQuery = `
            SELECT DISTINCT 
                b.id, 
                b.name as title, 
                b.author,
                b.image_url,
                b.tags,
                (SELECT COUNT(*) FROM borrowings WHERE book_id = b.id) as borrow_count
            FROM books b
            JOIN borrowings br ON b.id = br.book_id
            WHERE br.student_id != ?
                AND b.tags IS NOT NULL
                AND (
                    ${tagsArray.map(() => "b.tags LIKE '%' || ? || '%'").join(' OR ')}
                )
            ORDER BY borrow_count DESC
            LIMIT 6
        `;

        db.all(recommendedBooksQuery, [studentId, ...tagsArray], (err, rows) => {
            if (err) {
                console.error("Database error:", err.message);
                return res.status(500).json({ error: "Database error" });
            }

            // Calculate rating based on matching tags and borrow count
            const recommendedBooks = rows.map(book => {
                const bookTags = book.tags.split(',').map(tag => tag.trim());
                const matchingTagsCount = bookTags.filter(tag => studentTags.has(tag)).length;
                const maxPossibleTags = Math.min(tagsArray.length, bookTags.length);
                const tagMatchRatio = matchingTagsCount / maxPossibleTags;
                
                // Rating is based on tag match ratio (0.5-1.0) plus borrow count influence (0-0.5)
                const baseRating = 0.5 + (tagMatchRatio * 0.5);
                const borrowInfluence = Math.min(book.borrow_count / 10, 0.5);
                const rating = baseRating + borrowInfluence;

                return {
                    id: book.id,
                    title: book.title,
                    author: book.author,
                    image_url: book.image_url || '/assets/pic/default-book.jpg',
                    rating: Math.min(5, Math.round(rating * 10) / 10)
                };
            });

            res.json(recommendedBooks);
        });
    });
});

// Add endpoint to fetch overdue books
app.get('/api/overdue-books', (req, res) => {
    const query = `
        SELECT 
            b.id,
            bk.name as title,
            s.name as studentName,
            b.borrow_date as borrowDate,
            b.due_date as dueDate,
            b.return_date as returnDate,
            ROUND(JULIANDAY('now') - JULIANDAY(b.due_date)) as daysOverdue
        FROM borrowings b
        JOIN books bk ON b.book_id = bk.id
        JOIN students s ON b.student_id = s.id
        WHERE b.settled = 0 
        AND b.due_date <= datetime('now', 'localtime')
        ORDER BY b.due_date ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }

        // Format dates and ensure daysOverdue is a positive number
        const overdueBooks = rows.map(row => ({
            ...row,
            borrowDate: new Date(row.borrowDate).toISOString(),
            dueDate: new Date(row.dueDate).toISOString(),
            daysOverdue: Math.max(0, row.daysOverdue)
        }));

        res.json(overdueBooks);
    });
});

// Add this endpoint before app.listen
app.post('/api/test-due-notifications', (req, res) => {
    console.log("Manual test of due notifications triggered");
    checkDueBooksAndSendNotifications();
    res.json({ message: "Due date notification check triggered" });
});

// Modify the update-due-date endpoint
app.post('/api/update-due-date', (req, res) => {
    const { borrowId } = req.body;
    const today = moment().tz('Asia/Manila').format('YYYY-MM-DD HH:mm:ss');
    
    if (!borrowId) {
        return res.status(400).json({ error: "Borrow ID is required" });
    }

    // Start a transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Update the due date
        db.run(
            'UPDATE borrowings SET due_date = ? WHERE id = ?',
            [today, borrowId],
            function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error("Database error:", err.message);
                    return res.status(500).json({ error: "Failed to update due date" });
                }

                // Get the student and book details for the notification
                const query = `
                    SELECT 
                        s.name as student_name,
                        s.email as student_email,
                        bk.name as book_name
                    FROM borrowings b
                    JOIN students s ON b.student_id = s.id
                    JOIN books bk ON b.book_id = bk.id
                    WHERE b.id = ?
                `;

                db.get(query, [borrowId], (err, row) => {
                    if (err) {
                        db.run('ROLLBACK');
                        console.error("Database error:", err.message);
                        return res.status(500).json({ error: "Failed to get borrowing details" });
                    }

                    if (row) {
                        // Send email notification
                        const mailOptions = {
                            from: 'emanuelrato774@gmail.com', // BAGUHIN TO EMAIL NG LIBRARY
                            to: row.student_email,
                            subject: 'Book Due Today - Library Management System',
                            html: `
                                <h2>Book Due Today</h2>
                                <p>Dear ${row.student_name},</p>
                                <p>This is a reminder that your book "${row.book_name}" is due today.</p>
                                <p>Please return the book to the library as soon as possible to avoid any late fees.</p>
                                <p>Thank you for your cooperation!</p>
                                <p>Best regards,<br>Library Management System</p>
                            `
                        };

                        transporter.sendMail(mailOptions, function(error, info) {
                            if (error) {
                                console.error('Error sending email:', error);
                            } else {
                                console.log('Due date notification sent:', info.response);
                            }
                            db.run('COMMIT');
                            res.json({ 
                                message: "Due date updated successfully",
                                notificationSent: !error
                            });
                        });
                    } else {
                        db.run('COMMIT');
                        res.json({ message: "Due date updated successfully" });
                    }
                });
            }
        );
    });
});

// Add endpoint for searching students
app.get('/api/students/search', (req, res) => {
    const { query } = req.query;
    
    if (!query) {
        return res.status(400).json({ success: false, error: "Search query is required" });
    }

    const searchQuery = `
        SELECT id, name, username
        FROM students
        WHERE id LIKE ? OR username LIKE ? OR name LIKE ?
    `;

    db.all(searchQuery, [`%${query}%`, `%${query}%`, `%${query}%`], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ success: false, error: "Database error" });
        }

        if (!rows || rows.length === 0) {
            return res.json({ success: false, error: "No students found" });
        }

        res.json({
            success: true,
            students: rows
        });
    });
});

// Add endpoint for searching books
app.get('/api/books/search', (req, res) => {
    const { query } = req.query;
    
    if (!query) {
        return res.status(400).json({ success: false, error: "Search query is required" });
    }

    const searchQuery = `
        SELECT id, name as title, author
        FROM books
        WHERE id = ? OR name LIKE ? OR author LIKE ?
        LIMIT 5
    `;

    db.all(searchQuery, [query, `%${query}%`, `%${query}%`], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ success: false, error: "Database error" });
        }

        if (!rows || rows.length === 0) {
            return res.json({ success: false, error: "No books found" });
        }

        res.json({
            success: true,
            books: rows
        });
    });
});

// Add this function to verify email configuration
function verifyEmailConfig() {
    console.log("Verifying email configuration...");
    transporter.verify(function(error, success) {
        if (error) {
            console.error("Email configuration error:", error);
        } else {
            console.log("Email server is ready to send messages");
        }
    });
}

// Call this function when the server starts
verifyEmailConfig();

// Add endpoint for deleting books
app.delete('/api/delete-book/:id', (req, res) => {
    const bookId = req.params.id;

    if (!bookId) {
        return res.status(400).json({ error: "Book ID is required" });
    }

    // Start a transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // First get the book data
        db.get('SELECT * FROM books WHERE id = ?', [bookId], (err, book) => {
            if (err) {
                db.run('ROLLBACK');
                console.error("Database error:", err.message);
                return res.status(400).json({ error: "Failed to get book data" });
            }

            if (!book) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: "Book not found" });
            }

            // Insert into deleted_books
            const insertQuery = `
                INSERT INTO deleted_books (
                    original_id, ISBN, name, author, publication_year,
                    category, language, shelf_location, copies_available,
                    qr_code, number_of_page, tags, image_url
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.run(insertQuery, [
                book.id,
                book.ISBN,
                book.name,
                book.author,
                book.publication_year,
                book.category,
                book.language,
                book.shelf_location,
                book.copies_available,
                book.qr_code,
                book.number_of_page,
                book.tags,
                book.image_url
            ], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error("Database error:", err.message);
                    return res.status(400).json({ error: "Failed to archive book" });
                }

                // Delete from books table
                const deleteQuery = `DELETE FROM books WHERE id = ?`;
                db.run(deleteQuery, [book.id], function(err) {
                    if (err) {
                        db.run('ROLLBACK');
                        console.error("Database error:", err.message);
                        return res.status(400).json({ error: "Failed to delete book" });
                    }

                    db.run('COMMIT');
                    res.status(200).json({ 
                        message: "Book archived successfully!",
                        archivedId: this.lastID 
                    });
                });
            });
        });
    });
});

// Get student details by ID
app.post('/api/get-student', (req, res) => {
    const { id } = req.body;
    
    if (!id) {
        return res.status(400).json({ success: false, message: 'Student ID is required' });
    }

    db.get('SELECT * FROM students WHERE id = ?', [id], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        if (!row) {
            return res.status(404).json({ success: false, message: 'Student not found' });
        }

        res.json({ success: true, student: row });
    });
});

// Get book details by ID
app.post('/api/get-book', (req, res) => {
    const { id } = req.body;
    
    if (!id) {
        return res.status(400).json({ success: false, message: 'Book ID is required' });
    }

    db.get('SELECT * FROM books WHERE id = ?', [id], (err, row) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).json({ success: false, message: 'Database error' });
        }
        
        if (!row) {
            return res.status(404).json({ success: false, message: 'Book not found' });
        }

        res.json({ success: true, book: row });
    });
});

// Add endpoint for adding rewards
app.post('/api/rewards', upload.single('image'), (req, res) => {
    const { name, points_required, item_count, description } = req.body;

    if (!name || !points_required || !item_count) {
        return res.status(400).json({ success: false, error: "Name, points required, and item count are required" });
    }

    // Get the image URL if a file was uploaded
    const imageUrl = req.file ? `/assets/pic/rewards/${req.file.filename}` : null;

    const query = `
        INSERT INTO rewards (
            name,
            points_required,
            item_count,
            description,
            image_url
        ) VALUES (?, ?, ?, ?, ?)
    `;

    db.run(query, [
        name,
        parseInt(points_required),
        parseInt(item_count),
        description || null,
        imageUrl
    ], function(err) {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ success: false, error: "Failed to add reward" });
        }

        res.status(201).json({
            success: true,
            message: "Reward added successfully",
            rewardId: this.lastID,
            imageUrl: imageUrl
        });
    });
});

// Add endpoint for getting all rewards
app.get('/api/rewards', (req, res) => {
    const query = `
        SELECT * FROM rewards
        ORDER BY created_at DESC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ success: false, error: "Failed to fetch rewards" });
        }

        res.json({
            success: true,
            rewards: rows
        });
    });
});

// Add endpoint for getting a single reward
app.get('/api/rewards/:id', (req, res) => {
    const { id } = req.params;

    const query = `
        SELECT * FROM rewards
        WHERE id = ?
    `;

    db.get(query, [id], (err, row) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ success: false, error: "Failed to fetch reward" });
        }

        if (!row) {
            return res.status(404).json({ success: false, error: "Reward not found" });
        }

        res.json({
            success: true,
            reward: row
        });
    });
});

// Add endpoint for redeeming a reward
app.post('/api/rewards/redeem', (req, res) => {
    const { reward_id, student_id, quantity } = req.body;

    if (!reward_id || !student_id || !quantity) {
        return res.status(400).json({ success: false, error: "Reward ID, student ID, and quantity are required" });
    }

    // Start a transaction
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // First check if the reward exists and has enough items
        db.get('SELECT * FROM rewards WHERE id = ?', [reward_id], (err, reward) => {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ success: false, error: "Database error" });
            }

            if (!reward) {
                db.run('ROLLBACK');
                return res.status(404).json({ success: false, error: "Reward not found" });
            }

            if (reward.item_count < quantity) {
                db.run('ROLLBACK');
                return res.status(400).json({ success: false, error: "Not enough items available" });
            }

            // Check if student has enough points
            db.get('SELECT points FROM students WHERE id = ?', [student_id], (err, student) => {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ success: false, error: "Database error" });
                }

                if (!student) {
                    db.run('ROLLBACK');
                    return res.status(404).json({ success: false, error: "Student not found" });
                }

                const totalPointsRequired = reward.points_required * quantity;
                if (student.points < totalPointsRequired) {
                    db.run('ROLLBACK');
                    return res.status(400).json({ success: false, error: "Not enough points" });
                }

                // Update reward item count
                db.run(
                    'UPDATE rewards SET item_count = item_count - ? WHERE id = ?',
                    [quantity, reward_id],
                    function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ success: false, error: "Failed to update reward" });
                        }

                        // Update student points
                        db.run(
                            'UPDATE students SET points = points - ? WHERE id = ?',
                            [totalPointsRequired, student_id],
                            function(err) {
                                if (err) {
                                    db.run('ROLLBACK');
                                    return res.status(500).json({ success: false, error: "Failed to update student points" });
                                }

                                // Record the redemption
                                db.run(
                                    'INSERT INTO reward_redemptions (reward_id, student_id, quantity) VALUES (?, ?, ?)',
                                    [reward_id, student_id, quantity],
                                    function(err) {
                                        if (err) {
                                            db.run('ROLLBACK');
                                            return res.status(500).json({ success: false, error: "Failed to record redemption" });
                                        }

                                        db.run('COMMIT');
                                        res.json({
                                            success: true,
                                            message: "Reward redeemed successfully",
                                            pointsDeducted: totalPointsRequired
                                        });
                                    }
                                );
                            }
                        );
                    }
                );
            });
        });
    });
});

// Add endpoint for deleting a reward
app.delete('/api/rewards/:id', (req, res) => {
    const { id } = req.params;

    db.run('DELETE FROM rewards WHERE id = ?', [id], function(err) {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ success: false, error: "Failed to delete reward" });
        }

        if (this.changes === 0) {
            return res.status(404).json({ success: false, error: "Reward not found" });
        }

        res.json({
            success: true,
            message: "Reward deleted successfully"
        });
    });
});

// Add endpoint to get deleted students
app.get('/api/deleted-students', (req, res) => {
    const query = `
        SELECT * FROM deleted_students 
        ORDER BY deleted_at DESC
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Failed to fetch deleted students" });
        }
        res.json(rows);
    });
});

// Add endpoint to get deleted books
app.get('/api/deleted-books', (req, res) => {
    const query = `
        SELECT * FROM deleted_books 
        ORDER BY deleted_at DESC
    `;
    
    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Failed to fetch deleted books" });
        }
        res.json(rows);
    });
});

// Add endpoint to restore a student
app.post('/api/restore-student/:id', (req, res) => {
    const { id } = req.params;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Get the student data from deleted_students
        db.get('SELECT * FROM deleted_students WHERE id = ?', [id], (err, student) => {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: "Failed to fetch student data" });
            }

            if (!student) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: "Deleted student not found" });
            }

            // Insert back into students table with original_id
            const insertQuery = `
                INSERT INTO students (
                    id, name, username, password, cellphone, 
                    email, points, qr_code
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.run(insertQuery, [
                student.original_id,
                student.name,
                student.username,
                student.password,
                student.cellphone,
                student.email,
                student.points,
                student.qr_code
            ], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: "Failed to restore student" });
                }

                // Delete from deleted_students
                db.run('DELETE FROM deleted_students WHERE id = ?', [id], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: "Failed to remove from archive" });
                    }

                    db.run('COMMIT');
                    res.json({ message: "Student restored successfully" });
                });
            });
        });
    });
});

// Add endpoint to restore a book
app.post('/api/restore-book/:id', (req, res) => {
    const { id } = req.params;
    
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');

        // Get the book data from deleted_books
        db.get('SELECT * FROM deleted_books WHERE id = ?', [id], (err, book) => {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: "Failed to fetch book data" });
            }

            if (!book) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: "Deleted book not found" });
            }

            // Insert back into books table with original ID
            const insertQuery = `
                INSERT INTO books (
                    id, ISBN, name, author, publication_year, category,
                    language, shelf_location, copies_available, qr_code,
                    number_of_page, tags, image_url
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `;

            db.run(insertQuery, [
                book.original_id,
                book.ISBN,
                book.name,
                book.author,
                book.publication_year,
                book.category,
                book.language,
                book.shelf_location,
                book.copies_available,
                book.qr_code,
                book.number_of_page,
                book.tags,
                book.image_url
            ], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: "Failed to restore book" });
                }

                // Delete from deleted_books
                db.run('DELETE FROM deleted_books WHERE id = ?', [id], (err) => {
                    if (err) {
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: "Failed to remove from archive" });
                    }

                    db.run('COMMIT');
                    res.json({ message: "Book restored successfully" });
                });
            });
        });
    });
});

// Add endpoint to permanently delete a student
app.delete('/api/delete-student-permanent/:id', (req, res) => {
    const { id } = req.params;
    
    db.run('DELETE FROM deleted_students WHERE id = ?', [id], function(err) {
        if (err) {
            return res.status(500).json({ error: "Failed to delete student permanently" });
        }
        res.json({ message: "Student deleted permanently" });
    });
});

// Add endpoint to permanently delete a book
app.delete('/api/delete-book-permanent/:id', (req, res) => {
    const { id } = req.params;
    
    db.run('DELETE FROM deleted_books WHERE id = ?', [id], function(err) {
        if (err) {
            return res.status(500).json({ error: "Failed to delete book permanently" });
        }
        res.json({ message: "Book deleted permanently" });
    });
});

// Add endpoints for bulk operations
app.post('/api/restore-students', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
        return res.status(400).json({ error: "Invalid request" });
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        let errorOccurred = false;
        let completed = 0;

        ids.forEach((id) => {
            db.get('SELECT * FROM deleted_students WHERE id = ?', [id], (err, student) => {
                if (err || !student) {
                    errorOccurred = true;
                    completed++;
                    if (completed === ids.length) finalize();
                    return;
                }
                db.run(
                    `INSERT INTO students (id, name, username, password, cellphone, email, points, qr_code)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        student.original_id,
                        student.name,
                        student.username,
                        student.password,
                        student.cellphone,
                        student.email,
                        student.points,
                        student.qr_code
                    ],
                    function (err) {
                        if (err) {
                            errorOccurred = true;
                        } else {
                            db.run('DELETE FROM deleted_students WHERE id = ?', [id], function (err) {
                                if (err) errorOccurred = true;
                                completed++;
                                if (completed === ids.length) finalize();
                            });
                            return;
                        }
                        completed++;
                        if (completed === ids.length) finalize();
                    }
                );
            });
        });

        function finalize() {
            if (errorOccurred) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: "Failed to restore students" });
            }
            db.run('COMMIT');
            res.json({ message: "Students restored successfully" });
        }
    });
});

app.post('/api/restore-books', (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids)) {
        return res.status(400).json({ error: "Invalid request" });
    }

    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        let errorOccurred = false;
        let completed = 0;

        ids.forEach((id) => {
            db.get('SELECT * FROM deleted_books WHERE id = ?', [id], (err, book) => {
                if (err || !book) {
                    errorOccurred = true;
                    completed++;
                    if (completed === ids.length) finalize();
                    return;
                }
                db.run(
                    `INSERT INTO books (id, ISBN, name, author, publication_year, category, language, shelf_location, copies_available, qr_code, number_of_page, tags, image_url)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        book.original_id,
                        book.ISBN,
                        book.name,
                        book.author,
                        book.publication_year,
                        book.category,
                        book.language,
                        book.shelf_location,
                        book.copies_available,
                        book.qr_code,
                        book.number_of_page,
                        book.tags,
                        book.image_url
                    ],
                    function (err) {
                        if (err) {
                            errorOccurred = true;
                        } else {
                            db.run('DELETE FROM deleted_books WHERE id = ?', [id], function (err) {
                                if (err) errorOccurred = true;
                                completed++;
                                if (completed === ids.length) finalize();
                            });
                            return;
                        }
                        completed++;
                        if (completed === ids.length) finalize();
                    }
                );
            });
        });

        function finalize() {
            if (errorOccurred) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: "Failed to restore books" });
            }
            db.run('COMMIT');
            res.json({ message: "Books restored successfully" });
        }
    });
});

// Get books currently borrowed by a specific student, with optional search
app.get('/api/borrowed-books/:studentId', (req, res) => {
    const { studentId } = req.params;
    const { query } = req.query;
    if (!studentId) {
        return res.status(400).json({ error: 'Student ID is required' });
    }
    let sql = `
        SELECT bk.id, bk.name as name, bk.author
        FROM books bk
        JOIN borrowings b ON bk.id = b.book_id
        WHERE b.student_id = ? AND b.settled = 0
    `;
    const params = [studentId];
    if (query) {
        sql += ' AND (bk.id = ? OR bk.name LIKE ? OR bk.author LIKE ?)';
        params.push(query, `%${query}%`, `%${query}%`);
    }
    sql += ' ORDER BY bk.name ASC LIMIT 5';
    db.all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true, books: rows });
    });
});

// Get books available to borrow, with optional search
app.get('/api/available-books', (req, res) => {
    const { query } = req.query;
    let sql = `
        SELECT bk.id, bk.name as name, bk.author
        FROM books bk
        WHERE bk.copies_available > 0
    `;
    const params = [];
    if (query) {
        sql += ' AND (bk.id = ? OR bk.name LIKE ? OR bk.author LIKE ?)';
        params.push(query, `%${query}%`, `%${query}%`);
    }
    sql += ' ORDER BY bk.name ASC LIMIT 5';
    db.all(sql, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        res.json({ success: true, books: rows });
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});

// Add new endpoint for sending password change emails
app.post('/api/send-password-change-email', (req, res) => {
    const { studentId, email, name } = req.body;

    if (!studentId || !email || !name) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    // Generate reset token
    const token = require('crypto').randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 3 * 24 * 3600000); // 3 days from now

    // Store reset token in database
    db.run(
        'INSERT INTO password_resets (user_id, user_type, token, expiry) VALUES (?, ?, ?, ?)',
        [studentId, 'student', token, expiry.toISOString()],
        function(err) {
            if (err) {
                console.error('Database error:', err);
                return res.status(500).json({ success: false, error: 'Failed to store reset token' });
            }

            // Create reset link
            const resetLink = `${BASE_URL}/reset-password.html?token=${token}`;

            // Email content
            const mailOptions = {
                from: 'emanuelrato774@gmail.com',
                to: email,
                subject: 'Welcome to Library Management System - Set Your Password',
                html: `
                    <h2>Welcome to Library Management System</h2>
                    <p>Dear ${name},</p>
                    <p>Your account has been created in the Library Management System. To set your password, please click the link below:</p>
                    <p><a href="${resetLink}">${resetLink}</a></p>
                    <p>This link will expire in 3 days.</p>
                    <p>Best regards,<br>Library Management System</p>
                `
            };

            // Send email
            transporter.sendMail(mailOptions, function(error, info) {
                if (error) {
                    console.error('Email error:', error);
                    return res.status(500).json({ 
                        success: false, 
                        error: 'Failed to send email',
                        details: error.message 
                    });
                }
                console.log('Email sent:', info.response);
                res.json({ 
                    success: true, 
                    message: 'Password change instructions sent to student email'
                });
            });
        }
    );
});

// Get student rewards
app.get('/api/student/rewards', (req, res) => {
    const sql = `
        SELECT 
            id, 
            name, 
            description, 
            points_required as points, 
            image_url,
            CASE 
                WHEN item_count <= 0 THEN 0 
                ELSE 1 
            END as available,
            item_count
        FROM rewards
        ORDER BY points_required ASC
    `;
    
    db.all(sql, [], (err, rows) => {
        if (err) {
            console.error('Error fetching rewards:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        res.json(rows || []);
    });
});

// Get student points history
app.get('/api/student/points/history/:studentId', (req, res) => {
    const { studentId } = req.params;
    
    // First get the student's current points
    db.get('SELECT points FROM students WHERE id = ?', [studentId], (err, student) => {
        if (err) {
            console.error('Error fetching student points:', err);
            return res.status(500).json({ error: 'Database error' });
        }

        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }

        // Then get the points history
        const sql = `
            SELECT 
                ph.id,
                ph.points,
                ph.description,
                ph.date,
                ph.activity_type,
                CASE 
                    WHEN ph.activity_type = 'borrow' THEN 'Book Borrowed'
                    WHEN ph.activity_type = 'return' THEN 'Book Returned'
                    WHEN ph.activity_type = 'reward' THEN 'Reward Redeemed'
                    ELSE ph.activity_type
                END as activity
            FROM points_history ph
            WHERE ph.student_id = ?
            ORDER BY ph.date DESC
        `;
        
        db.all(sql, [studentId], (err, rows) => {
            if (err) {
                console.error('Error fetching points history:', err);
                return res.status(500).json({ error: 'Database error' });
            }
            
            // Format the response
            const history = (rows || []).map(row => ({
                id: row.id,
                points: row.points,
                description: row.description,
                date: row.date,
                activity: row.activity
            }));

            // Add current points to the response
            const response = {
                currentPoints: student.points || 0,
                history: history
            };
            
            res.json(response);
        });
    });
});

// Redeem reward
app.post('/api/student/rewards/redeem', (req, res) => {
    const { studentId, rewardId, points } = req.body;
    
    if (!studentId || !rewardId || !points) {
        return res.status(400).json({ error: 'Missing required fields' });
    }
    
    // Start transaction
    db.run('BEGIN TRANSACTION');
    
    // Check if student has enough points
    db.get('SELECT points FROM students WHERE id = ?', [studentId], (err, student) => {
        if (err) {
            db.run('ROLLBACK');
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!student) {
            db.run('ROLLBACK');
            return res.status(404).json({ error: 'Student not found' });
        }
        
        if (student.points < points) {
            db.run('ROLLBACK');
            return res.status(400).json({ error: 'Not enough points' });
        }
        
        // Get reward details
        db.get('SELECT name FROM rewards WHERE id = ?', [rewardId], (err, reward) => {
            if (err) {
                db.run('ROLLBACK');
                return res.status(500).json({ error: 'Database error' });
            }
            
            if (!reward) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: 'Reward not found' });
            }
            
            // Deduct points
            db.run('UPDATE students SET points = points - ? WHERE id = ?', [points, studentId], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: 'Database error' });
                }
                
                // Add to points history
                const description = `Redeemed reward: ${reward.name}`;
                db.run(
                    'INSERT INTO points_history (student_id, points, description, date, activity_type) VALUES (?, ?, ?, datetime("now"), "reward")',
                    [studentId, -points, description],
                    function(err) {
                        if (err) {
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: 'Database error' });
                        }
                        
                        // Commit transaction
                        db.run('COMMIT');
                        res.json({ 
                            message: 'Reward redeemed successfully',
                            remainingPoints: student.points - points
                        });
                    }
                );
            });
        });
    });
});

// Get single student data
app.get('/api/students/:id', (req, res) => {
    const { id } = req.params;
    
    const sql = `
        SELECT 
            id,
            name,
            username,
            cellphone,
            email,
            points,
            qr_code
        FROM students 
        WHERE id = ?
    `;
    
    db.get(sql, [id], (err, student) => {
        if (err) {
            console.error('Error fetching student:', err);
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!student) {
            return res.status(404).json({ error: 'Student not found' });
        }
        
        res.json(student);
    });
});

// Add endpoint to get all books
app.get('/api/books', (req, res) => {
    const query = `
        SELECT 
            id as book_id,
            name,
            author,
            publication_year,
            category,
            language,
            shelf_location,
            copies_available,
            number_of_page,
            tags,
            image_url,
            available
        FROM books
        ORDER BY name ASC
    `;

    db.all(query, [], (err, rows) => {
        if (err) {
            console.error("Database error:", err.message);
            return res.status(500).json({ error: "Database error" });
        }
        res.json(rows);
    });
});

// Add this endpoint for deleting multiple books
app.delete('/api/delete-books', (req, res) => {
    console.log('Received delete-books request');
    console.log('Request body:', req.body);
    
    const { bookIds } = req.body;
    
    if (!bookIds || !Array.isArray(bookIds) || bookIds.length === 0) {
        console.log('Invalid request: missing or invalid bookIds');
        return res.status(400).json({ error: "Please provide an array of book IDs to delete" });
    }

    console.log('Processing deletion for book IDs:', bookIds);
    
    // Start transaction
    db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
            console.error('Error starting transaction:', err);
            return res.status(500).json({ error: "Failed to start transaction" });
        }

        // First, get all books that exist
        const placeholders = bookIds.map(() => '?').join(',');
        const query = `SELECT * FROM books WHERE id IN (${placeholders})`;
        
        db.all(query, bookIds, (err, books) => {
            if (err) {
                console.error('Error fetching books:', err);
                db.run('ROLLBACK');
                return res.status(500).json({ error: "Failed to fetch books" });
            }

            if (books.length === 0) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: "No books found with the provided IDs" });
            }

            // Archive all books at once
            const archiveValues = books.map(book => [
                book.id, // original_id
                book.ISBN,
                book.name,
                book.author,
                book.publication_year,
                book.category,
                book.language,
                book.shelf_location,
                book.copies_available,
                book.qr_code,
                book.number_of_page,
                book.tags,
                book.image_url
            ]);

            const archivePlaceholders = archiveValues.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(',');
            const archiveQuery = `
                INSERT INTO deleted_books (
                    original_id, ISBN, name, author, publication_year, category, 
                    language, shelf_location, copies_available, qr_code, 
                    number_of_page, tags, image_url
                ) VALUES ${archivePlaceholders}
            `;

            db.run(archiveQuery, archiveValues.flat(), (err) => {
                if (err) {
                    console.error('Error archiving books:', err);
                    db.run('ROLLBACK');
                    return res.status(500).json({ error: "Failed to archive books" });
                }

                // Delete all books at once
                const deleteQuery = `DELETE FROM books WHERE id IN (${placeholders})`;
                db.run(deleteQuery, bookIds, (err) => {
                    if (err) {
                        console.error('Error deleting books:', err);
                        db.run('ROLLBACK');
                        return res.status(500).json({ error: "Failed to delete books" });
                    }

                    // Commit transaction
                    db.run('COMMIT', (err) => {
                        if (err) {
                            console.error('Error committing transaction:', err);
                            db.run('ROLLBACK');
                            return res.status(500).json({ error: "Failed to commit transaction" });
                        }

                        console.log(`Successfully deleted ${books.length} books`);
                        res.json({ 
                            message: `${books.length} book(s) deleted successfully`,
                            deletedCount: books.length
                        });
                    });
                });
            });
        });
    });
});

// Add endpoint for deleting multiple students
app.delete('/api/delete-students', (req, res) => {
    const { studentIds } = req.body;
    
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
        return res.status(400).json({ error: "Please provide an array of student IDs to delete" });
    }

    // Start transaction
    db.run('BEGIN TRANSACTION', (err) => {
        if (err) {
            console.error('Error starting transaction:', err);
            return res.status(500).json({ error: "Failed to start transaction" });
        }

        // First, get all students that exist
        const placeholders = studentIds.map(() => '?').join(',');
        const query = `SELECT * FROM students WHERE id IN (${placeholders})`;

        db.all(query, studentIds, (err, students) => {
            if (err) {
                db.run('ROLLBACK');
                console.error('Error fetching students:', err);
                return res.status(500).json({ error: "Failed to fetch students" });
            }

            if (students.length === 0) {
                db.run('ROLLBACK');
                return res.status(404).json({ error: "No students found with the provided IDs" });
            }

            // Archive each student
            let completed = 0;
            let errors = [];

            students.forEach(student => {
                // Insert into deleted_students
                const insertQuery = `
                    INSERT INTO deleted_students (
                        original_id, name, username, password, 
                        cellphone, email, points, qr_code
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                `;

                db.run(insertQuery, [
                    student.id,
                    student.name,
                    student.username,
                    student.password,
                    student.cellphone,
                    student.email,
                    student.points,
                    student.qr_code
                ], function(err) {
                    if (err) {
                        errors.push(`Failed to archive student ${student.id}`);
                    } else {
                        // Delete from students table
                        db.run('DELETE FROM students WHERE id = ?', [student.id], function(err) {
                            if (err) {
                                errors.push(`Failed to delete student ${student.id}`);
                            }
                            completed++;
                            if (completed === students.length) {
                                if (errors.length > 0) {
                                    db.run('ROLLBACK');
                                    res.status(500).json({ error: errors.join(', ') });
                                } else {
                                    db.run('COMMIT');
                                    res.status(200).json({ 
                                        message: `${students.length} student(s) archived successfully!`,
                                        archivedCount: students.length
                                    });
                                }
                            }
                        });
                    }
                });
            });
        });
    });
});

// Add this near other email-related functions
async function sendQRCodeEmail(studentId) {
    try {
        // Get student data from database
        const student = await new Promise((resolve, reject) => {
            db.get('SELECT * FROM students WHERE id = ?', [studentId], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });

        if (!student) {
            throw new Error('Student not found');
        }

        // Get QR code data
        const qrCodeData = student.qr_code;
        if (!qrCodeData) {
            throw new Error('QR code not found');
        }

        // Create email content with proper image handling
        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: student.email,
            subject: 'Your Library QR Code - Little Heirs Academy',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #2563eb;">Little Heirs Academy Library</h2>
                    <p>Dear ${student.name},</p>
                    <p>Please find your library QR code attached. You can use this QR code when borrowing or returning books at the library.</p>
                    <p>Keep this QR code safe and show it to the librarian when needed.</p>
                    <div style="text-align: center; margin: 20px 0;">
                        <img src="cid:qrcode" alt="Library QR Code" style="max-width: 200px;"/>
                    </div>
                    <p>Best regards,<br>Little Heirs Academy Library Team</p>
                </div>
            `,
            attachments: [{
                filename: 'library-qr-code.png',
                content: qrCodeData.split('base64,')[1],
                encoding: 'base64',
                cid: 'qrcode'
            }]
        };

        // Send email
        await transporter.sendMail(mailOptions);
        return true;
    } catch (error) {
        console.error('Error sending QR code email:', error);
        throw error;
    }
}

// Add this with other API endpoints
app.post('/api/students/send-qr-email/:id', async (req, res) => {
    try {
        const studentId = req.params.id; // Use string ID directly
        await sendQRCodeEmail(studentId);
        res.json({ success: true, message: 'QR code email sent successfully' });
    } catch (error) {
        console.error('Error in send-qr-email endpoint:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to send QR code email',
            error: error.message 
        });
    }
});

// Add endpoint to reset book ID counter
app.post('/api/reset-book-counter', (req, res) => {
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Delete all books
        db.run('DELETE FROM books', [], function(err) {
            if (err) {
                db.run('ROLLBACK');
                console.error("Database error:", err.message);
                return res.status(500).json({ error: "Failed to delete books" });
            }
            
            // Reset the auto-increment counter
            db.run('DELETE FROM sqlite_sequence WHERE name = "books"', [], function(err) {
                if (err) {
                    db.run('ROLLBACK');
                    console.error("Database error:", err.message);
                    return res.status(500).json({ error: "Failed to reset counter" });
                }
                
                db.run('COMMIT');
                res.json({ 
                    success: true, 
                    message: "Book ID counter reset successfully. New books will start from ID 1." 
                });
            });
        });
    });
});

// Add endpoint to reset student ID counter
app.post('/api/reset-student-counter', (req, res) => {
    db.serialize(() => {
        db.run('BEGIN TRANSACTION');
        
        // Delete all students
        db.run('DELETE FROM students', [], function(err) {
            if (err) {
                db.run('ROLLBACK');
                console.error("Database error:", err.message);
                return res.status(500).json({ error: "Failed to delete students" });
            }
            
            db.run('COMMIT');
            res.json({ 
                success: true, 
                message: "All students deleted successfully. New students will start from ID format: YYYY-0001" 
            });
        });
    });
});


