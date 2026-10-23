module.exports = {
  config: {
    name: "ai",
    version: "1.0.0",
    author: "GoatBot Custom",
    countDown: 5,
    role: 0,
    shortDescription: {
      en: "Ask AI anything"
    },
    longDescription: {
      en: "Get instant answers from AI model"
    },
    category: "ai",
    guide: {
      en: "{p}ai <your question>"
    }
  },

  onStart: async function ({ api, event, args, message }) {
    const prompt = args.join(" ");
    if (!prompt) {
      return message.reply("❌ অনুগ্রহ করে আপনার প্রশ্নটি লিখুন। উদাহরণ: .ai বাংলাদেশ এর রাজধানী কি?");
    }

    message.reply("🔍 উত্তর খোঁজা হচ্ছে, অনুগ্রহ করে অপেক্ষা করুন...");

    try {
      const response = await fetch(`https://api.kenliejugarap.com/ai/?question=${encodeURIComponent(prompt)}`);
      const data = await response.json();

      if (data && data.response) {
        return message.reply(`🤖 **AI Answer:**\n\n${data.response}`);
      } else {
        return message.reply("⚠️ দুঃখিত, কোনো উত্তর পাওয়া যায়নি। আবার চেষ্টা করুন।");
      }
    } catch (error) {
      return message.reply("❌ কোনো সমস্যা হয়েছে, কিছুক্ষণ পর চেষ্টা করুন।");
    }
  }
};
