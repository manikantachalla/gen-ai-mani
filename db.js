// db.js
import jsonfile from 'jsonfile';
import path from 'path';
import { fileURLToPath } from 'url';

// Get the directory of the current module
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(__dirname, 'db.json');

const db = {
    data: {
        sessions: {},
        conversationHistory: {},
        images: {}
    },
    async read() {
        try {
            this.data = await jsonfile.readFile(file);
        } catch (error) {
            if (error.code === 'ENOENT') {
                // File does not exist, initialize with default data
                this.data = { sessions: {}, conversationHistory: {} };
            } else {
                throw error;
            }
        }
    },
    async write() {
        await jsonfile.writeFile(file, this.data, { spaces: 2 });
    }
};

await db.read();

export default db;
