const express = require('express');
const axios = require('axios');
const archiver = require('archiver');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');

const app = express();

// Security middleware to set various HTTP headers
app.use(helmet());

// Enable gzip compression for responses
app.use(compression());

// HTTP request logging
app.use(morgan(':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent"', {
    skip: (req, res) => req.ip === '127.0.0.1' || req.ip === '::1',
    stream: process.stdout
}));

// Parse incoming JSON requests
app.use(express.json());

// Trust first proxy
app.set('trust proxy', 1);

// Serve static files from the public folder
app.use(express.static('public'));

app.post('/localize', async (req, res) => {
    const cssUrl = req.body.cssUrl;
    if (!cssUrl) {
        return res.status(400).send('cssUrl is required');
    }
    
    // Validate the URL format
    try {
        new URL(cssUrl);
    } catch (err) {
        return res.status(400).send('Invalid URL format.');
    }

    try {
        // Fetch the original CSS file from the provided URL
        const cssResponse = await axios.get(cssUrl);
        let cssContent = cssResponse.data;
        
        // Capture all font URLs in the CSS using regex.
        const regex = /url\((['"]?)(https?:\/\/[^'")]+)\1\)/g;
        let match;
        const fontMap = new Map();
        while ((match = regex.exec(cssContent)) !== null) {
            const fontUrl = match[2];
            if (!fontMap.has(fontUrl)) {
                fontMap.set(fontUrl, null);
            }
        }
        
        // Download each font file and store its data in the map.
        for (let fontUrl of fontMap.keys()) {
            const fontResponse = await axios.get(fontUrl, { responseType: 'arraybuffer' });
            fontMap.set(fontUrl, fontResponse.data);
        }
        
        // Replace the URLs in the CSS with local paths (pointing to the fonts folder)
        let updatedCss = cssContent.replace(regex, (match, p1, fontUrl) => {
            const fileName = fontUrl.split('?')[0].split('/').pop();
            return `url("fonts/${fileName}")`;
        });
        
        // Set response headers so that the browser downloads a ZIP file.
        res.setHeader('Content-Disposition', 'attachment; filename="fonts.zip"');
        res.setHeader('Content-Type', 'application/zip');
        
        // Create a zip archive and pipe it directly to the response.
        const archive = archiver('zip');
        archive.pipe(res);
        
        // Append each downloaded font file to the "fonts" folder in the zip.
        for (let [fontUrl, fontData] of fontMap) {
            const fileName = fontUrl.split('?')[0].split('/').pop();
            archive.append(fontData, { name: 'fonts/' + fileName });
        }
        
        // Append the updated CSS file to the root of the zip.
        archive.append(updatedCss, { name: 'fonts.css' });
        
        await archive.finalize();
    } catch (error) {
        console.error('Error processing /localize:', error);
        res.status(500).send('Error processing request.');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
