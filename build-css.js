const { execSync } = require('child_process');

try {
    // Use npx to ensure we use the local version of tailwindcss
    execSync('npx tailwindcss -i ./src/input.css -o ./dist/output.css', { stdio: 'inherit' });
    
    console.log('CSS built successfully!');
} catch (error) {
    console.error('Error building CSS:', error);
    process.exit(1);
} 