// index.js
import express from 'express';
import axios from 'axios';
import bodyParser from 'body-parser';
import { v4 as uuidv4 } from 'uuid';
import cors from 'cors';
import db from './db.js';

const DALL_E_API_URL = 'https://api.openai.com/v1/images/generations'; // DALL·E image generation endpoint
const RESPONSE_API_URL = 'https://api.openai.com/v1/chat/completions';

const HUGGINGFACE_API_KEY = "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";
const OPENAI_API_KEY = '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';  // Replace with your OpenAI API key

const app = express();
const port = 4949;

app.use(cors());
app.use(bodyParser.json());

app.get('/api/get-image', async (req, res) => {
    try {
        const { sessionId } = req.query;
        const imagePrompt = db.data.images[sessionId]?.[db.data.images[sessionId].length - 1];

        if (!imagePrompt) {
            return res.status(400).send('Image prompt not found');
        }

        const response = await axios.post(DALL_E_API_URL, {
            prompt: imagePrompt,
            n: 1,
            size: '1024x1024', // Adjust the size as needed
        }, {
            headers: {
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const imageUrl = response.data.data[0].url; // URL of the generated image
        res.redirect(imageUrl); // Redirect the response to the generated image URL
    } catch (error) {
        console.error('Error generating image:', error);
        res.status(500).send('Error generating image: ' + error.message);
    }
});

app.post('/create-session', async (req, res) => {
    const { personA, personB, time, location, context, initialMessage } = req.body;

    if (!personA || !personB || !time || !location || !initialMessage || !context) {
        return res.status(400).send('Missing required fields');
    }

    const sessionId = uuidv4();

    db.data.sessions[sessionId] = { personA, personB, context, time, location, initialMessage };
    const imagePrompt = `Generate an image of a ${jsonToLabelValueString(personA)} at ${location} at ${time}. The initial message from this person was: '${initialMessage}'.`;
    db.data.images[sessionId] = [imagePrompt];

    await db.write();
    res.json({ sessionId });
});

app.post('/chat', async (req, res) => {
    const { userMessage, sessionId } = req.body;
    const { personA, personB, time, location, initialMessage, context } = db.data.sessions[sessionId] || {};

    if (!personA || !personB || !time || !location || !initialMessage || !userMessage || !sessionId) {
        return res.status(400).send('Missing required fields');
    }

    if (!db.data.conversationHistory[sessionId]) {
        db.data.conversationHistory[sessionId] = [
            { role: 'system', content: `You are a conversation partner in a romantic dialogue between two people, Person A and Person B. The dialogue should be rich in emotional expression and include descriptive actions. The characters should respond to each other with natural and engaging language, making the conversation feel authentic and lively.\n\nPerson A is a ${jsonToLabelValueString(personA)} who enjoys ${jsonToLabelValueString(context.interestsA)}. Person B is ${jsonToLabelValueString(personB)} and ${jsonToLabelValueString(context.interestsB)}.\n\nStart the conversation with Person A and Person B exchanging pleasantries and gradually build up the dialogue with playful and emotionally charged interactions. Include actions, facial expressions, and body language to make the conversation more vivid.\n\nHere is the current dialogue context:\n1. ${context.initialMessage}\n.  Strictly generate personA's reply i.e act as personA and don't decide person B's reply` }
        ];
    }

    db.data.conversationHistory[sessionId].push({ role: 'user', content: userMessage });

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
        console.log(reply);
        db.data.conversationHistory[sessionId].push({ role: 'assistant', content: reply });

        // Generate a new image prompt based on the latest conversation
        const latestImagePrompt = `Generate an image of a ${jsonToLabelValueString(personA)} at ${location} at ${time}. The latest context of the conversation includes: '${reply}'.`;
        db.data.images[sessionId] = db.data.images[sessionId] || [];
        db.data.images[sessionId].push(latestImagePrompt);

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

app.listen(port, () => {
    console.log(`Server listening at http://localhost:${port}`);
});