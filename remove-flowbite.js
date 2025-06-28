const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Flowbite removal process...\n');

// List of HTML files that contain Flowbite script tags
const htmlFiles = [
    'rewards.html',
    'returned.html',
    'reset-password.html',
    'recommended.html',
    'points.html',
    'login.html',
    'index.html',
    'history.html',
    'forgot-password.html',
    'studentdashboard.html',
    'borrowed.html',
    'booklist.html',
    'archive.html',
    'adminstudentmodule.html',
    'adminhistorymodule.html',
    'admindashboard.html',
    'adminbookmodule.html'
];

// Function to remove Flowbite script tags from HTML files
function removeFlowbiteFromHTML() {
    console.log('📝 Removing Flowbite script tags from HTML files...');
    
    htmlFiles.forEach(file => {
        const filePath = path.join(__dirname, file);
        
        if (fs.existsSync(filePath)) {
            try {
                let content = fs.readFileSync(filePath, 'utf8');
                const originalContent = content;
                
                // Remove Flowbite script tags
                content = content.replace(
                    /<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/flowbite\/[^"]*"><\/script>/g,
                    ''
                );
                content = content.replace(
                    /<script src="assets\/libs\/flowbite[^"]*"><\/script>/g,
                    ''
                );
                
                if (content !== originalContent) {
                    fs.writeFileSync(filePath, content, 'utf8');
                    console.log(`✅ Removed Flowbite from ${file}`);
                } else {
                    console.log(`ℹ️  No Flowbite found in ${file}`);
                }
            } catch (error) {
                console.error(`❌ Error processing ${file}:`, error.message);
            }
        } else {
            console.log(`⚠️  File not found: ${file}`);
        }
    });
}

// Function to remove Flowbite from package.json
function removeFlowbiteFromPackage() {
    console.log('\n📦 Removing Flowbite from package.json...');
    
    const packagePath = path.join(__dirname, 'package.json');
    
    if (fs.existsSync(packagePath)) {
        try {
            const packageContent = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
            const originalContent = JSON.stringify(packageContent, null, 2);
            
            // Remove Flowbite from dependencies
            if (packageContent.dependencies && packageContent.dependencies.flowbite) {
                delete packageContent.dependencies.flowbite;
                console.log('✅ Removed Flowbite from dependencies');
            }
            
            // Remove Flowbite from devDependencies
            if (packageContent.devDependencies && packageContent.devDependencies.flowbite) {
                delete packageContent.devDependencies.flowbite;
                console.log('✅ Removed Flowbite from devDependencies');
            }
            
            const newContent = JSON.stringify(packageContent, null, 2);
            
            if (newContent !== originalContent) {
                fs.writeFileSync(packagePath, newContent, 'utf8');
                console.log('✅ Updated package.json');
            } else {
                console.log('ℹ️  No Flowbite found in package.json');
            }
        } catch (error) {
            console.error('❌ Error processing package.json:', error.message);
        }
    } else {
        console.log('⚠️  package.json not found');
    }
}

// Function to remove Flowbite from tailwind.config.js
function removeFlowbiteFromTailwind() {
    console.log('\n🎨 Removing Flowbite from tailwind.config.js...');
    
    const tailwindPath = path.join(__dirname, 'tailwind.config.js');
    
    if (fs.existsSync(tailwindPath)) {
        try {
            let content = fs.readFileSync(tailwindPath, 'utf8');
            const originalContent = content;
            
            // Remove Flowbite plugin import
            content = content.replace(
                /require\('flowbite\/plugin'\)/g,
                ''
            );
            
            // Clean up empty plugins array
            content = content.replace(
                /plugins:\s*\[\s*\]/g,
                'plugins: []'
            );
            
            // Remove Flowbite from content paths
            content = content.replace(
                /,\s*"node_modules\/flowbite\/\*\*\/\*\.js"/g,
                ''
            );
            
            if (content !== originalContent) {
                fs.writeFileSync(tailwindPath, content, 'utf8');
                console.log('✅ Updated tailwind.config.js');
            } else {
                console.log('ℹ️  No Flowbite found in tailwind.config.js');
            }
        } catch (error) {
            console.error('❌ Error processing tailwind.config.js:', error.message);
        }
    } else {
        console.log('⚠️  tailwind.config.js not found');
    }
}

// Function to remove Flowbite from node_modules
function removeFlowbiteFromNodeModules() {
    console.log('\n🗂️  Removing Flowbite from node_modules...');
    
    const flowbitePath = path.join(__dirname, 'node_modules', 'flowbite');
    
    if (fs.existsSync(flowbitePath)) {
        try {
            fs.rmSync(flowbitePath, { recursive: true, force: true });
            console.log('✅ Removed Flowbite from node_modules');
        } catch (error) {
            console.error('❌ Error removing Flowbite from node_modules:', error.message);
        }
    } else {
        console.log('ℹ️  Flowbite not found in node_modules');
    }
}

// Function to remove Flowbite from assets
function removeFlowbiteFromAssets() {
    console.log('\n📁 Removing Flowbite from assets...');
    
    const assetsFlowbitePath = path.join(__dirname, 'assets', 'libs', 'flowbite');
    
    if (fs.existsSync(assetsFlowbitePath)) {
        try {
            fs.rmSync(assetsFlowbitePath, { recursive: true, force: true });
            console.log('✅ Removed Flowbite from assets/libs');
        } catch (error) {
            console.error('❌ Error removing Flowbite from assets:', error.message);
        }
    } else {
        console.log('ℹ️  Flowbite not found in assets/libs');
    }
}

// Main execution
try {
    console.log('🔍 Flowbite Removal Summary:');
    console.log('1. Remove Flowbite script tags from HTML files');
    console.log('2. Remove Flowbite from package.json dependencies');
    console.log('3. Remove Flowbite from tailwind.config.js');
    console.log('4. Remove Flowbite from node_modules');
    console.log('5. Remove Flowbite from assets/libs');
    
    removeFlowbiteFromHTML();
    removeFlowbiteFromPackage();
    removeFlowbiteFromTailwind();
    removeFlowbiteFromNodeModules();
    removeFlowbiteFromAssets();
    
    console.log('\n🎉 Flowbite removal completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Run: npm install (to clean up package-lock.json)');
    console.log('2. Run: npm run build:css (to rebuild CSS without Flowbite)');
    console.log('3. Test your application to ensure everything works');
    
} catch (error) {
    console.error('\n❌ Error during Flowbite removal:', error.message);
    process.exit(1);
} 