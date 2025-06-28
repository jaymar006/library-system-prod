const fs = require('fs');
const path = require('path');

console.log('🚀 Starting CSS path fix process...\n');

// List of HTML files that need CSS path fixes
const htmlFiles = [
    'adminbookmodule.html',
    'adminhistorymodule.html',
    'adminstudentmodule.html',
    'admindashboard.html',
    'archive.html',
    'booklist.html',
    'borrowed.html',
    'forgot-password.html',
    'history.html',
    'index.html',
    'login.html',
    'points.html',
    'recommended.html',
    'reset-password.html',
    'returned.html',
    'rewards.html',
    'studentdashboard.html'
];

// Function to fix CSS paths in HTML files
function fixCSSPaths() {
    console.log('📝 Fixing CSS paths in HTML files...');
    
    htmlFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        
        if (fs.existsSync(filePath)) {
            try {
                let content = fs.readFileSync(filePath, 'utf8');
                const originalContent = content;
                
                // Fix different CSS path patterns
                // Replace dist/output.css with dist/win-unpacked/dist/output.css
                content = content.replace(
                    /href="dist\/output\.css"/g, 
                    'href="dist/win-unpacked/dist/output.css"'
                );
                
                // Fix relative paths (like ../dist/output.css)
                content = content.replace(
                    /href="\.\.\/dist\/output\.css"/g, 
                    'href="../dist/win-unpacked/dist/output.css"'
                );
                
                // Fix ./dist/output.css
                content = content.replace(
                    /href="\.\/dist\/output\.css"/g, 
                    'href="./dist/win-unpacked/dist/output.css"'
                );
                
                if (content !== originalContent) {
                    fs.writeFileSync(filePath, content, 'utf8');
                    console.log(`✅ Fixed CSS path in ${file}`);
                } else {
                    console.log(`ℹ️  No CSS path changes needed in ${file}`);
                }
            } catch (error) {
                console.error(`❌ Error processing ${file}:`, error.message);
            }
        } else {
            console.log(`⚠️  File not found: ${file}`);
        }
    });
}

// Function to create a backup of original files
function createBackup() {
    console.log('\n💾 Creating backup of original files...');
    
    const backupDir = path.join(__dirname, 'backup-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-'));
    
    if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir);
    }
    
    htmlFiles.forEach(file => {
        const originalPath = path.join(__dirname, file);
        const backupPath = path.join(backupDir, file);
        
        if (fs.existsSync(originalPath)) {
            try {
                fs.copyFileSync(originalPath, backupPath);
                console.log(`✅ Backed up ${file}`);
            } catch (error) {
                console.error(`❌ Error backing up ${file}:`, error.message);
            }
        }
    });
    
    console.log(`📁 Backup created in: ${backupDir}`);
}

// Function to provide alternative solutions
function showAlternatives() {
    console.log('\n🔧 Alternative Solutions:');
    console.log('\nOption 1: Use relative path from app root');
    console.log('   Change all CSS paths to: href="./dist/output.css"');
    console.log('   This works if the HTML files are in the app root directory');
    
    console.log('\nOption 2: Use absolute path');
    console.log('   Change all CSS paths to: href="/dist/output.css"');
    console.log('   This works if the app serves files from the root');
    
    console.log('\nOption 3: Copy CSS to assets folder');
    console.log('   Copy output.css to assets/css/ and use: href="assets/css/output.css"');
    console.log('   This is more reliable for Electron apps');
    
    console.log('\nOption 4: Use Electron\'s app.getAppPath()');
    console.log('   In your main.js, set the correct path dynamically');
}

// Main execution
try {
    console.log('⚠️  WARNING: This will modify all HTML files to use the packed CSS path.');
    console.log('   Make sure you have a backup of your files before proceeding.\n');
    
    // Ask for confirmation (you can comment this out if you want to run automatically)
    console.log('📋 Files that will be modified:');
    htmlFiles.forEach(file => console.log(`   - ${file}`));
    
    console.log('\n🎯 Current CSS path: dist/output.css');
    console.log('🎯 New CSS path: dist/win-unpacked/dist/output.css');
    
    // Create backup first
    createBackup();
    
    // Fix the paths
    fixCSSPaths();
    
    console.log('\n🎉 CSS path fix completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Test your application to ensure CSS loads correctly');
    console.log('2. If issues persist, check the alternative solutions below');
    console.log('3. Restore from backup if needed: backup-[timestamp]/');
    
    showAlternatives();
    
} catch (error) {
    console.error('\n❌ Error during CSS path fix:', error.message);
    process.exit(1);
} 