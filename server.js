// index.js
import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import db from './db.js';

// import dotenv from 'dotenv';
// dotenv.config();


const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const IMAGE_API_URL_PRIMARY = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-3-medium';
const IMAGE_API_URL_FALLBACK = 'https://api-inference.huggingface.co/models/stabilityai/stable-diffusion-2'
const RESPONSE_API_URL = 'https://api.openai.com/v1/chat/completions';


const app = express();
const port = process.env.PORT || 4949;

app.use(cors());
app.use(bodyParser.json());

async function generateImage(imageInput, url) {
    const response = await axios.post(url, { inputs: imageInput }, {
        headers: {
            'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
            'Content-Type': 'application/json'
        },
        responseType: 'stream'
    });
    return response;
}


app.get('/api/get-image', async (req, res) => {
    try {
        const { sessionId } = req.query;
        const imagePrompt = createImagePrompt(sessionId);
        const imageInput = imagePrompt && imagePrompt.replace(/\n/g, ' ');

        try {
            const response = await generateImage(imageInput, IMAGE_API_URL_PRIMARY);
            res.setHeader('Content-Type', 'image/jpeg');
            response.data.pipe(res);
        } catch (primaryError) {
            if (primaryError.response && primaryError.response.status === 500) {
                console.warn('Primary API failed with 500, trying fallback API');
                try {
                    const response = await generateImage(imageInput, IMAGE_API_URL_FALLBACK);
                    res.setHeader('Content-Type', 'image/jpeg');
                    response.data.pipe(res);
                } catch (fallbackError) {
                    console.error('Fallback API also failed:', fallbackError);
                    res.status(500).send('Both primary and fallback APIs failed: ' + fallbackError.message);
                }
            } else {
                throw primaryError;
            }
        }
    } catch (error) {
        console.error('Error generating image:', error);
        res.status(500).send('Error generating image: ' + error.message);
    }
});

app.post('/create-session', async (req, res) => {
    const { character, scene, characterQualities, initialMessage } = req.body;

    if (!character || !scene || !initialMessage || !characterQualities) {
        return res.status(400).send('Missing required fields');
    }

    const sessionId = uuidv4();

    db.data.sessions[sessionId] = { character, characterQualities, scene, initialMessage };

    await db.write();
    res.json({ sessionId });
});

app.post('/chat', async (req, res) => {
    const { userMessage, sessionId } = req.body;
    const { character, scene, initialMessage, characterQualities } = db.data.sessions[sessionId] || {};

    if (!character || !scene || !initialMessage || !userMessage || !sessionId) {
        return res.status(400).send('Missing required fields');
    }

    if (!db.data.conversationHistory[sessionId]) {
        db.data.conversationHistory[sessionId] = [
            { role: 'system', message: `${character}: ${initialMessage}`, content: `*Scene: ${scene}*. You are a conversation partner(on behalf of character ${character}) (with qualities ${characterQualities}) in a romantic dialogue between two people, You ${character} and user(who is chatting). The dialogue should be rich in emotional expression and include descriptive actions. You should respond to other person with natural and engaging language, making the conversation feel authentic and lively. conversation between You (${character}) and User should be exchanging pleasantries and gradually build up the dialogue with playful and emotionally charged interactions. Include actions, facial expressions, and body language to make the conversation more vivid. Here is the your first dialogue context: ${initialMessage}\n. Stricly generate character's reply i.e act as character and don't decide User's reply` }
        ];
    }

    db.data.conversationHistory[sessionId].push({ role: 'user', content: userMessage, message: `user: ${userMessage}` });

    const promptMessages = db.data.conversationHistory[sessionId];

    try {
        const response = await axios.post(RESPONSE_API_URL, {
            model: 'gpt-3.5-turbo',
            messages: promptMessages,
            max_tokens: 150,
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            }
        });

        const reply = response.data.choices[0].message.content;
        db.data.conversationHistory[sessionId].push({ role: 'assistant', content: reply, message: `${character}: ${reply}` });

        await db.write();
        res.json({
            reply
        });
    } catch (error) {
        console.error(error);
        res.status(500).send('An error occurred: ' + error.message);
    }
});

function jsonToLabelValueString(jsonObject) {
    if (typeof jsonObject === "string") {
        return jsonObject;
    }
    if (!jsonObject) {
        return '';
    }
    let result = '';

    for (const [key, value] of Object.entries(jsonObject)) {
        result += `${key}: ${value} `;
    }

    return result.trim();
}

const createImagePrompt = (sessionId) => {
    const { character, scene, initialMessage, characterQualities } = db.data.sessions[sessionId] || {};
    const history = db.data.conversationHistory[sessionId] || [];
    const convo = history.map(p => p.message).join("; ")
    const message = `Generate a image of ${character} (with qualities ${characterQualities}) image at ${scene}. covo history is ${convo}`
    return message;
}

// Function to generate a prompt for OpenAI's API
const generatePrompt = () => {
    return "Generate an image of Sneha, an extroverted woman, standing on a balcony overlooking the Mumbai seashore in the early morning. She is dressed in red attire that contrasts with the vibrant, serene seashore backdrop. Sneha is engaged in a lovely conversation with the user. In the image, Sneha should: be near the balcony railing with a picturesque view of the Mumbai seashore and the morning sky; exhibit a warm, lively demeanor, reflecting her extroverted nature; appear to be blushing and giggling, feeling a rush of excitement from the conversation; have a playful and mischievous grin, with a wink, while feeling the warmth of the morning sun on her face; convey warmth, intimacy, and a touch of flirtation. Conversation Context: Sneha: 'Hi, How are you?' User: 'I want to kiss you.' Sneha: *Blushes and giggles, feeling excited.* 'Oh, you always know how to make my heart race! *playfully leans in closer* But shh, not so fast. Let's savor the moment with a little tease.' Sneha winks with a mischievous grin, feeling the warmth of the morning sun on her face. User: 'I want to kiss you.' Sneha: *Chuckles softly, feeling butterflies in her stomach.* 'You're persistent, aren't you? *teasingly bites her lip* Well, maybe just a little kiss wouldn't hurt. But where's the fun in being too easy?' Sneha playfully moves a bit closer, her eyes sparkling with mischief and anticipation.";
};

// Function to call OpenAI API
const callOpenAI = async (originalPrompt) => {
    try {
        const messages = [{ role: 'system', content: `correct the prompt for image generation to set the right context to image gen api: ${originalPrompt}` }]
        const response = await axios.post(RESPONSE_API_URL, {
            model: 'gpt-3.5-turbo',
            messages: messages,
            max_tokens: 150,
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json',
            }
        });
        return response.data.choices[0].message.content;
    } catch (error) {
        console.error('Error calling OpenAI API:', error);

    }
};




app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});
