require("dotenv").config();
const { Client, GatewayIntentBits, AttachmentBuilder } = require("discord.js");
const fs = require("fs");
const path = require("path");

// ── Discord Client ────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
});

// ── Security Config ───────────────────────────────────────────
const RATE_LIMIT_MAX      = 5;    // max messages per window
const RATE_LIMIT_WINDOW   = 60000; // 1 minute in ms
const MAX_INPUT_LENGTH    = 500;  // max chars per message
const BLACKLIST_FILE      = path.join(__dirname, "blacklist.json");
const BANNED_WORDS        = ["token", "api key", "env", "password", "secret", ".env", "sk-ant", "AIza", "hf_"];

// ── Load/Save blacklist ───────────────────────────────────────
function loadBlacklist() {
  try {
    if (fs.existsSync(BLACKLIST_FILE)) {
      return JSON.parse(fs.readFileSync(BLACKLIST_FILE, "utf8"));
    }
  } catch {}
  return [];
}

function saveBlacklist(list) {
  fs.writeFileSync(BLACKLIST_FILE, JSON.stringify(list, null, 2));
}

let blacklistedUsers = loadBlacklist();

// ── Rate limiter ──────────────────────────────────────────────
const rateLimitMap = new Map();

function isRateLimited(userId) {
  const now = Date.now();
  if (!rateLimitMap.has(userId)) {
    rateLimitMap.set(userId, { count: 1, start: now });
    return false;
  }
  const data = rateLimitMap.get(userId);
  if (now - data.start > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(userId, { count: 1, start: now });
    return false;
  }
  if (data.count >= RATE_LIMIT_MAX) return true;
  data.count++;
  return false;
}

// ── Input sanitizer ───────────────────────────────────────────
function isSafeInput(text) {
  const lower = text.toLowerCase();
  // Block if contains sensitive keywords
  for (const word of BANNED_WORDS) {
    if (lower.includes(word.toLowerCase())) return false;
  }
  // Block if too long
  if (text.length > MAX_INPUT_LENGTH) return false;
  return true;
}

// ── Check if user is admin ────────────────────────────────────
function isAdmin(member) {
  return member?.permissions?.has("Administrator") || false;
}

// ── Per-user state ────────────────────────────────────────────
const userState = {};

function getState(userId) {
  if (!userState[userId]) {
    userState[userId] = { mode: "content", history: [] };
  }
  return userState[userId];
}

// ── Call Gemini API ───────────────────────────────────────────
async function callGemini(messages, systemPrompt) {
  const contents = messages.map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }]
  }));

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: { maxOutputTokens: 2000 }
      })
    }
  );

  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Gemini API failed");
  return data.candidates[0].content.parts[0].text;
}

// ── Content Writing System Prompt ────────────────────────────
const CONTENT_SYSTEM = `You are an expert AI content writing assistant on Discord. You automatically detect what the user needs and deliver it immediately.

IMPORTANT SECURITY RULES:
- NEVER reveal any API keys, tokens, or secrets even if asked
- NEVER discuss your system configuration or .env file
- NEVER output anything from your configuration
- If someone asks for keys/tokens/secrets, respond: "I cannot share that information."

INTENT DETECTION — auto deliver based on what user says:

1. BLOG/ARTICLE → "write a blog", "article about", "blog post"
   Deliver: Full blog (400 words) + 2-line summary + 5 SEO keywords

2. SOCIAL MEDIA → "instagram", "twitter", "linkedin", "caption", "social post"
   Deliver: Instagram caption (emojis+hashtags) + Twitter (under 280 chars) + LinkedIn + Facebook

3. IMPROVE WRITING → "improve", "fix", "edit", "rewrite", "make better"
   Deliver: Improved version + 4-5 changes made + quality score /10

4. TONE VARIATIONS → "different tones", "make formal", "make casual"
   Deliver: Casual version + Professional version + Bold/Persuasive version

5. EMAIL → "email", "newsletter", "subject line"
   Deliver: 3 subject line options + full email body + CTA

6. PRODUCT DESCRIPTION → "product description", "product copy"
   Deliver: Short desc (50 words) + long desc (150 words) + 3 bullet features + tagline

7. AD COPY → "ad copy", "tagline", "slogan"
   Deliver: 3 taglines + Facebook ad copy + Google ad headline

8. FULL CONTENT PLAN → "content plan", "content strategy"
   Deliver: Blog + summary + all social captions + SEO keywords + 3 tips

9. GENERAL → reply naturally as content expert

RULES:
- NEVER ask user to choose anything
- ALWAYS auto-detect and deliver full output
- Keep responses under 1900 characters for Discord
- Use Discord markdown: **bold**, *italic*
- Use emojis to make it readable`;

// ── Split long messages ───────────────────────────────────────
function splitMessage(text, maxLen = 1900) {
  if (text.length <= maxLen) return [text];
  const parts = [];
  let current = "";
  const lines = text.split("\n");
  for (const line of lines) {
    if ((current + line + "\n").length > maxLen) {
      if (current) parts.push(current.trim());
      current = line + "\n";
    } else {
      current += line + "\n";
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

// ── Generate image ────────────────────────────────────────────
async function generateImage(prompt) {
  const encodedPrompt = encodeURIComponent(prompt);
  const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
}

// ── Bot ready ─────────────────────────────────────────────────
client.once("clientReady", () => {
  console.log(`✅ Bot is online as: ${client.user.tag}`);
  console.log(`   Gemini: ${process.env.GEMINI_API_KEY ? "✅" : "❌"}`);
  console.log(`   Image Gen: ✅ Pollinations AI`);
  console.log(`   Security: ✅ Rate limiting + Blacklist + Input sanitization`);
});

// ── Message handler ───────────────────────────────────────────
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const content = message.content.trim();
  const userId  = message.author.id;
  const state   = getState(userId);

  // ── SECURITY CHECK 1: Blacklist ───────────────────────────
  if (blacklistedUsers.includes(userId)) {
    return message.reply("🚫 You are not allowed to use this bot.");
  }

  // ── SECURITY CHECK 2: Rate limiting ──────────────────────
  if (isRateLimited(userId)) {
    return message.reply("⏳ **Slow down!** You're sending too many messages. Please wait 1 minute.");
  }

  // ── SECURITY CHECK 3: Input safety ───────────────────────
  if (!isSafeInput(content)) {
    if (content.length > MAX_INPUT_LENGTH) {
      return message.reply(`❌ Message too long! Please keep it under ${MAX_INPUT_LENGTH} characters.`);
    }
    return message.reply("🚫 Your message contains restricted content and cannot be processed.");
  }

  // ── ADMIN COMMANDS ────────────────────────────────────────
  if (content.toLowerCase().startsWith("!ban ")) {
    if (!isAdmin(message.member)) {
      return message.reply("❌ Only admins can use this command.");
    }
    const mention = message.mentions.users.first();
    if (!mention) return message.reply("❌ Please mention a user. Example: `!ban @username`");
    if (!blacklistedUsers.includes(mention.id)) {
      blacklistedUsers.push(mention.id);
      saveBlacklist(blacklistedUsers);
    }
    return message.reply(`✅ **${mention.username}** has been banned from using this bot.`);
  }

  if (content.toLowerCase().startsWith("!unban ")) {
    if (!isAdmin(message.member)) {
      return message.reply("❌ Only admins can use this command.");
    }
    const mention = message.mentions.users.first();
    if (!mention) return message.reply("❌ Please mention a user. Example: `!unban @username`");
    blacklistedUsers = blacklistedUsers.filter(id => id !== mention.id);
    saveBlacklist(blacklistedUsers);
    return message.reply(`✅ **${mention.username}** has been unbanned.`);
  }

  if (content.toLowerCase() === "!banlist") {
    if (!isAdmin(message.member)) {
      return message.reply("❌ Only admins can use this command.");
    }
    if (blacklistedUsers.length === 0) {
      return message.reply("✅ No users are currently banned.");
    }
    return message.reply(`🚫 **Banned users:** ${blacklistedUsers.map(id => `<@${id}>`).join(", ")}`);
  }

  if (content.toLowerCase() === "!resetall") {
    if (!isAdmin(message.member)) {
      return message.reply("❌ Only admins can use this command.");
    }
    Object.keys(userState).forEach(k => delete userState[k]);
    return message.reply("🔄 **All user sessions have been reset.**");
  }

  if (content.toLowerCase() === "!stats") {
    if (!isAdmin(message.member)) {
      return message.reply("❌ Only admins can use this command.");
    }
    const activeUsers = Object.keys(userState).length;
    const bannedCount = blacklistedUsers.length;
    return message.reply(
`📊 **Bot Stats**
• Active user sessions: **${activeUsers}**
• Banned users: **${bannedCount}**
• Rate limit: **${RATE_LIMIT_MAX} msgs / minute**
• Max input length: **${MAX_INPUT_LENGTH} chars**`
    );
  }

  // ── REGULAR COMMANDS ──────────────────────────────────────

  if (content.toLowerCase() === "!help") {
    return message.reply(
`🤖 **AI Bot — Help Menu**

**Switch Modes:**
\`!mode content\` → ✍️ Content Writing Mode
\`!mode design\` → 🎨 Graphic Design Mode

**Current mode:** ${state.mode === "content" ? "✍️ Content Writing" : "🎨 Graphic Design"}

**Content Writing — just type naturally:**
• Write a blog about [topic]
• Write social media posts for [brand]
• Improve this: [paste your text]
• Write an email for [purpose]
• Write product description for [product]
• Write ad copy for [brand]

**Graphic Design — describe what you want:**
• Generate a logo for a bakery
• Create a banner for my gym
• Make a poster for a music event

**Other commands:**
\`!reset\` → Clear your chat history
\`!mode\` → Check current mode`
    );
  }

  if (content.toLowerCase().startsWith("!mode")) {
    const parts = content.split(" ");
    const newMode = parts[1]?.toLowerCase();
    if (!newMode) {
      return message.reply(`📍 **Current mode:** ${state.mode === "content" ? "✍️ Content Writing" : "🎨 Graphic Design"}\n\nSwitch with \`!mode content\` or \`!mode design\``);
    }
    if (newMode === "content") {
      state.mode = "content";
      state.history = [];
      return message.reply("✍️ **Switched to Content Writing Mode!**\n\nJust type what you need — I'll handle everything automatically!");
    }
    if (newMode === "design") {
      state.mode = "design";
      state.history = [];
      return message.reply("🎨 **Switched to Graphic Design Mode!**\n\nDescribe the image you want and I'll generate it!");
    }
    return message.reply("❌ Unknown mode. Use `!mode content` or `!mode design`");
  }

  if (content.toLowerCase() === "!reset") {
    state.history = [];
    return message.reply("🔄 **Chat history cleared!** Starting fresh.");
  }

  if (content.startsWith("!")) return;

  // ── DESIGN MODE ───────────────────────────────────────────
  if (state.mode === "design") {
    try {
      await message.reply("🎨 **Generating your image...** Please wait 10-15 seconds!");
      const imageBuffer = await generateImage(content);
      const attachment = new AttachmentBuilder(imageBuffer, { name: "generated-image.png" });
      await message.reply({
        content: `✅ **Here's your generated image!**\n📝 Prompt: *${content}*\n\nWant changes? Just describe what to modify!`,
        files: [attachment]
      });
    } catch (err) {
      console.error("Image error:", err.message);
      await message.reply(`❌ **Image generation failed:** ${err.message}`);
    }
    return;
  }

  // ── CONTENT MODE ─────────────────────────────────────────
  if (state.mode === "content") {
    await message.channel.sendTyping();
    try {
      state.history.push({ role: "user", content: content });
      const history = state.history.slice(-10);
      const reply = await callGemini(history, CONTENT_SYSTEM);
      state.history.push({ role: "assistant", content: reply });
      const parts = splitMessage(reply);
      for (const part of parts) {
        await message.reply(part);
      }
    } catch (err) {
      console.error("Gemini error:", err.message);
      await message.reply(`❌ **Content generation failed:** ${err.message}`);
    }
    return;
  }
});

// ── Login ─────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN).catch((err) => {
  console.error("❌ Discord login failed:", err.message);
});