const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Student-related functions
    addStudent: (studentData) => ipcRenderer.invoke('add-student', studentData),
    addStudents: (studentsData) => ipcRenderer.invoke('add-students', studentsData),
    getStudents: () => ipcRenderer.invoke('get-students'),
    
    // Book-related functions
    addBook: (bookData) => ipcRenderer.invoke('add-book', bookData),
    addBooks: (booksData) => ipcRenderer.invoke('add-books', booksData),
    getBooks: () => ipcRenderer.invoke('get-books'),
    updateBook: (bookData) => ipcRenderer.invoke('update-book', bookData),
    
    // Borrowing-related functions
    recordBorrowing: (borrowData) => ipcRenderer.invoke('record-borrowing', borrowData),
    getHistory: () => ipcRenderer.invoke('get-history'),
    getOverdueBooks: () => ipcRenderer.invoke('get-overdue-books'),

    // Window controls
    minimize: () => ipcRenderer.send('minimize-window'),
    maximize: () => ipcRenderer.send('maximize-window'),
    close: () => ipcRenderer.send('close-window'),

    // Settlement-related functions
    updateSettlement: (data) => ipcRenderer.invoke('update-settlement', data)
});
