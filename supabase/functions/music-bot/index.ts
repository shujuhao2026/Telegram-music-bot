import { Bot, InlineKeyboard, webhookCallback } from "https://deno.land/x/grammy@v1.21.1/mod.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const NETEASE_API = Deno.env.get("NETEASE_API") || ""; // 你的网易云API地址

const bot = new Bot(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// /start 命令
bot.command("start", async (ctx) => {
  await ctx.reply(
    "欢迎使用 MusicFinder！\n\n" +
    "直接发送歌曲名或歌手名即可搜索。\n" +
    "群组请使用 /vmo 前缀，例如：\n" +
    "/vmo 着魔"
  );
});

// 处理文字消息（支持 /vmo 和直接发歌名）
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text.trim();
  let keyword = text;

  if (text.startsWith("/vmo")) {
    keyword = text.replace(/^\/vmo\s*/i, "").trim();
  }

  // 忽略纯命令
  if (!keyword || keyword.startsWith("/")) return;

  try {
    if (!NETEASE_API) {
      return await ctx.reply("音乐API地址尚未配置，请联系管理员。");
    }

    // 调用网易云搜索
    const searchUrl = `${NETEASE_API}/search?keywords=${encodeURIComponent(keyword)}&type=1&limit=10`;
    const res = await fetch(searchUrl);
    const data = await res.json();

    const songs = data.result?.songs || [];
    if (songs.length === 0) {
      return await ctx.reply(`没有找到与「${keyword}」相关的歌曲`);
    }

    // 保存搜索结果到数据库
    const { data: session, error } = await supabase
      .from("search_sessions")
      .insert({
        chat_id: ctx.chat.id,
        user_id: ctx.from.id,
        keyword,
        results: songs,
        page: 1,
      })
      .select()
      .single();

    if (error) {
      console.error(error);
      return await ctx.reply("搜索出错，请稍后再试");
    }

    // 构建回复消息
    let msg = `🔍 搜索「${keyword}」结果：\n\n`;
    const keyboard = new InlineKeyboard();

    songs.forEach((song: any, i: number) => {
      const artists = song.artists?.map((a: any) => a.name).join(" & ") || "未知歌手";
      msg += `${i + 1}. ${song.name} - ${artists}\n`;
      keyboard.text(String(i + 1), `play:${song.id}:${session.id}`).row();
    });

    // 可选：下一页按钮
    keyboard.text("下一页", `next:${session.id}`);

    await ctx.reply(msg, { reply_markup: keyboard });
  } catch (err) {
    console.error(err);
    await ctx.reply("搜索失败，请稍后再试");
  }
});

// 处理点击数字播放
bot.callbackQuery(/^play:(\d+):(.+)$/, async (ctx) => {
  const songId = ctx.match![1];
  const sessionId = ctx.match![2];

  try {
    // 获取播放链接
    const urlRes = await fetch(`${NETEASE_API}/song/url/v1?id=${songId}&level=exhigh`);
    const urlData = await urlRes.json();
    const playUrl = urlData.data?.[0]?.url;

    if (!playUrl) {
      return await ctx.answerCallbackQuery({
        text: "这首歌暂时无法播放（可能需要会员）",
        show_alert: true,
      });
    }

    // 获取歌曲信息
    const detailRes = await fetch(`${NETEASE_API}/song/detail?ids=${songId}`);
    const detailData = await detailRes.json();
    const song = detailData.songs?.[0];
    const title = song?.name || "未知歌曲";
    const artist = song?.ar?.map((a: any) => a.name).join(" & ") || "未知歌手";

    // 记录历史
    await supabase.from("play_history").insert({
      chat_id: ctx.chat?.id,
      user_id: ctx.from?.id,
      song_id: songId,
      song_name: title,
      artist,
    });

    // 发送音频
    await ctx.replyWithAudio(playUrl, {
      title,
      performer: artist,
    });

    await ctx.answerCallbackQuery();
  } catch (err) {
    console.error(err);
    await ctx.answerCallbackQuery({ text: "播放失败", show_alert: true });
  }
});

// 启动 Webhook 处理
const handleUpdate = webhookCallback(bot, "std/http");

Deno.serve(async (req) => {
  try {
    return await handleUpdate(req);
  } catch (err) {
    console.error(err);
    return new Response("Error", { status: 500 });
  }
});
