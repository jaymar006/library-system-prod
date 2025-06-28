const fs = require('fs');
const path = require('path');

// Function to copy CSS file to assets/css
function copyCSSToAssets() {
    const sourceCSS = path.join(__dirname, 'dist', 'output.css');
    const assetsDir = path.join(__dirname, 'assets', 'css');
    const targetCSS = path.join(assetsDir, 'output.css');
    
    try {
        // Create assets/css directory if it doesn't exist
        if (!fs.existsSync(assetsDir)) {
            fs.mkdirSync(assetsDir, { recursive: true });
            console.log('✅ Created assets/css directory');
        }
        
        // Copy CSS file
        if (fs.existsSync(sourceCSS)) {
            fs.copyFileSync(sourceCSS, targetCSS);
            console.log('✅ Copied output.css to assets/css/output.css');
        } else {
            console.log('⚠️  Source CSS file not found at dist/output.css');
        }
    } catch (error) {
        console.error('❌ Error copying CSS file:', error.message);
    }
}

// Run the function
copyCSSToAssets(); 