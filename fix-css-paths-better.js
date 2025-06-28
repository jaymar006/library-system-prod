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

// Function to create assets/css directory and copy CSS file
function setupAssetsCSS() {
    console.log('📁 Setting up assets/css directory...');
    
    const assetsDir = path.join(__dirname, 'assets', 'css');
    const sourceCSS = path.join(__dirname, 'dist', 'output.css');
    const targetCSS = path.join(assetsDir, 'output.css');
    
    try {
        // Create assets/css directory if it doesn't exist
        if (!fs.existsSync(assetsDir)) {
            fs.mkdirSync(assetsDir, { recursive: true });
            console.log('✅ Created assets/css directory');
        }
        
        // Copy CSS file to assets/css
        if (fs.existsSync(sourceCSS)) {
            fs.copyFileSync(sourceCSS, targetCSS);
            console.log('✅ Copied output.css to assets/css/');
        } else {
            console.log('⚠️  Source CSS file not found, creating empty file');
            fs.writeFileSync(targetCSS, '/* CSS file will be generated here */');
        }
    } catch (error) {
        console.error('❌ Error setting up assets/css:', error.message);
    }
}

// Function to fix CSS paths to use assets/css (RECOMMENDED)
function fixCSSPathsToAssets() {
    console.log('\n📝 Fixing CSS paths to use assets/css (RECOMMENDED)...');
    
    htmlFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        
        if (fs.existsSync(filePath)) {
            try {
                let content = fs.readFileSync(filePath, 'utf8');
                const originalContent = content;
                
                // Replace all CSS path patterns with assets/css/output.css
                content = content.replace(
                    /href="dist\/output\.css"/g, 
                    'href="assets/css/output.css"'
                );
                content = content.replace(
                    /href="\.\.\/dist\/output\.css"/g, 
                    'href="assets/css/output.css"'
                );
                content = content.replace(
                    /href="\.\/dist\/output\.css"/g, 
                    'href="assets/css/output.css"'
                );
                content = content.replace(
                    /href="dist\/win-unpacked\/dist\/output\.css"/g, 
                    'href="assets/css/output.css"'
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

// Function to fix CSS paths to packed location (ALTERNATIVE)
function fixCSSPathsToPacked() {
    console.log('\n📝 Fixing CSS paths to packed location (ALTERNATIVE)...');
    
    htmlFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        
        if (fs.existsSync(filePath)) {
            try {
                let content = fs.readFileSync(filePath, 'utf8');
                const originalContent = content;
                
                // Replace with packed CSS path
                content = content.replace(
                    /href="dist\/output\.css"/g, 
                    'href="dist/win-unpacked/dist/output.css"'
                );
                content = content.replace(
                    /href="\.\.\/dist\/output\.css"/g, 
                    'href="../dist/win-unpacked/dist/output.css"'
                );
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

// Main execution
try {
    console.log('🔧 CSS Path Fix Options:');
    console.log('\n1. RECOMMENDED: Move CSS to assets/css/ (works in both dev and production)');
    console.log('2. ALTERNATIVE: Use packed CSS path (only works in production)');
    console.log('3. MANUAL: Choose your own path');
    
    console.log('\n📋 Files that will be modified:');
    htmlFiles.forEach(file => console.log(`   - ${file}`));
    
    // Create backup first
    createBackup();
    
    // Use the recommended approach
    console.log('\n🎯 Using RECOMMENDED approach: assets/css/output.css');
    setupAssetsCSS();
    fixCSSPathsToAssets();
    
    console.log('\n🎉 CSS path fix completed successfully!');
    console.log('\n📋 What was done:');
    console.log('1. ✅ Created assets/css/ directory');
    console.log('2. ✅ Copied output.css to assets/css/output.css');
    console.log('3. ✅ Updated all HTML files to use assets/css/output.css');
    console.log('4. ✅ Created backup of original files');
    
    console.log('\n📋 Next steps:');
    console.log('1. Update your build script to copy CSS to assets/css/');
    console.log('2. Test your application in both development and production');
    console.log('3. If you prefer the packed path approach, run the alternative script');
    
    console.log('\n🔧 To update your build script, add this to package.json:');
    console.log('   "postbuild:css": "cp dist/output.css assets/css/output.css"');
    
} catch (error) {
    console.error('\n❌ Error during CSS path fix:', error.message);
    process.exit(1);
} 