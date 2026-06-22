# 🤖 Discord AI Bot — Setup Guide
## Content Writing + Graphic Design in One Bot

---

## 🔑 API Keys Needed

| Key | Get From |
|---|---|
| Discord Token | discord.com/developers |
| Claude API Key | console.anthropic.com |
| Gemini API Key | aistudio.google.com |

---

## 🚀 Setup Steps

### 1. Install dependencies
```bash
cd discord-bot
npm install
```

### 2. Add API keys in .env
```
DISCORD_TOKEN=your_token (already added)
CLAUDE_API_KEY=paste_claude_key_here
GEMINI_API_KEY=paste_gemini_key_here
```

### 3. Start the bot
```bash
node bot.js
```

---

## 💬 How to Use in Discord

### Switch Modes
```
!mode content   → Content Writing Mode
!mode design    → Graphic Design Mode
!mode           → Check current mode
!reset          → Clear chat history
!help           → Show all commands
```

### Content Writing Mode
Just type naturally:
- "Write a blog about AI trends"
- "Write social media posts for my cafe"
- "Improve this: [paste text]"
- "Write an email for a product launch"
- "Write ad copy for my gym"

### Graphic Design Mode
Describe the image:
- "Generate a logo for a bakery in brown tones"
- "Create a banner for a fitness brand"
- "Make a poster for a music festival"

---

## 🔄 Run 24/7 with PM2
```bash
npm install -g pm2
pm2 start bot.js --name "discord-bot"
pm2 startup && pm2 save
```
# chat_bot
