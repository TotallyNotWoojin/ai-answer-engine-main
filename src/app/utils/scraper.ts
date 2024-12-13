import axios from "axios";
import * as cheerio from "cheerio";
import { Redis } from "@upstash/redis";
import chromium from '@sparticuz/chromium'
import puppeteer from "puppeteer-core";

export const urlPattern =
  /https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|www\.[a-zA-Z0-9][a-zA-Z0-9-]+[a-zA-Z0-9]\.[^\s]{2,}|https?:\/\/(?:www\.|(?!www))[a-zA-Z0-9]+\.[^\s]{2,}|www\.[a-zA-Z0-9]+\.[^\s]{2,}/gi;

const CACHE_TTL = 7 * (24 * 60 * 60);
const MAX_CACHE_SIZE = 1024000;

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDISH_REST_TOKEN,
});

function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").replace(/\n+/g, " ").trim();
}

export async function scrapeUrl(url: string) {
  try {
    const cached = await getCachedContent(url);
    if (cached) {
      return cached;
    }
    const response = await axios.get(url);
    console.log(response);
    const $ = cheerio.load(response.data);
    console.log("response data: ", response.data);
    const title = $("title").text();
    console.log($);
    $("script").remove();
    $("style").remove();
    $("noscript").remove();
    $("iframe").remove();
    const metaDescription = $('meta[name="description"]').attr("content") || "";
    const h1 = $("h1")
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    const h2 = $("h2")
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    const articleText = $("article")
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    const mainText = $("main")
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    const contentText = $('.content, #content, [class*="content"]')
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    const paragraphs = $("p")
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    const listItems = $("li")
      .map((_, el) => $(el).text())
      .get()
      .join(" ");
    let combinedContent = [
      title,
      metaDescription,
      h1,
      h2,
      articleText,
      mainText,
      contentText,
      paragraphs,
      listItems,
    ].join(" ");
    combinedContent = cleanText(combinedContent).slice(0, 40000);

    const finalResponse = {
      url,
      title: cleanText(title),
      headings: {
        h1: cleanText(h1),
        h2: cleanText(h2),
      },
      metaDescription: cleanText(metaDescription),
      content: combinedContent,
      error: null,
    };

    await cacheContent(url, finalResponse);
    return finalResponse;
  } catch (error) {
    try{
        const isLocal = !!process.env.CHROME_EXECUTABLE_PATH;
        const browser = await puppeteer.launch({
            args: isLocal ? puppeteer.defaultArgs() : [...chromium.args, '--hide-scrollbars','--incognito','--no-sandbox'],
            defaultViewport: chromium.defaultViewport,
            executablePath: process.env.CHROME_EXECUTABLE_PATH || await chromium.executablePath(),
            headless: chromium.headless,
        });
        const page = await browser.newPage();
        await page.goto(url, {waitUntil:"domcontentloaded"});
        const content = await page.evaluate(() => {
            const title = document.title;
            const metaDescription = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
            const h1 = document.querySelector('h1')?.textContent || '';
            const h2 = document.querySelector('h2')?.textContent || '';
            const article = document.querySelector('article')?.textContent || '';
            const main = document.querySelector('main')?.textContent || '';
            const content = document.querySelector('.content, #content, [class*="content"]')?.textContent || '';
            const paragraphs = Array.from(document.querySelectorAll('p')).map(p => p.textContent).join(' ');
            const listItems = Array.from(document.querySelectorAll('li')).map(li => li.textContent).join(' ');
            return { title, metaDescription, h1, h2, article, main, content, paragraphs, listItems };
        });
        console.log(content);

        let combinedContent = [
            content.title,
            content.metaDescription,
            content.h1,
            content.h2,
            content.article,
            content.main,
            content.content,
            content.paragraphs,
            content.listItems,
        ].join(" ");
        combinedContent = cleanText(combinedContent).slice(0, 40000);

        const finalResponse = {
            url,
            title: cleanText(content.title),
            headings: {
                h1: cleanText(content.h1),
                h2: cleanText(content.h2),
            },
            metaDescription: cleanText(content.metaDescription),
            content: combinedContent,
            error: null,
        };

        await cacheContent(url, finalResponse);
        return finalResponse;

        
    } catch{
        console.error(`Error Scraping ${url}:`, error);
        return {
        url,
        title: "",
        headings: { h1: "", h2: "" },
        metaDescription: "",
        content: "",
        error: "Failed to scrape URL",
        };
    }
  }
}

export interface ScrapedContent {
  url: string;
  title: string;
  headings: {
    h1: string;
    h2: string;
  };
  metaDescription: string;
  content: string;
  error: string | null;
  cachedAt?: number;
}

function isValidScrapedContent(data: any): data is ScrapedContent {
  return (
    typeof data === "object" &&
    data !== null &&
    typeof data.url === "string" &&
    typeof data.title === "string" &&
    typeof data.headings === "object" &&
    typeof data.headings.h1 === "string" &&
    typeof data.headings.h2 === "string" &&
    typeof data.metaDescription === "string" &&
    typeof data.content === "string" &&
    (data.error === null || typeof data.error === "string")
  );
}

function getCacheKey(url: string): string {
  const sanitizedURL = url.substring(0, 200);
  return `scrape:${sanitizedURL}`;
}
async function getCachedContent(url: string): Promise<ScrapedContent | null> {
  try {
    const cacheKey = getCacheKey(url);
    const cached = await redis.get(cacheKey);
    if (!cached) {
      return null;
    }
    let parsed: any;
    if (typeof cached === "string") {
      try {
        parsed = JSON.parse(cached);
      } catch (parseError) {
        await redis.del(cacheKey);
        return null;
      }
    } else {
      parsed = cached;
    }
    if (isValidScrapedContent(parsed)) {
      const age = Date.now() - (parsed.cachedAt || 0);
      return parsed;
    }
    await redis.del(cacheKey);
    return null;
  } catch (error) {
    return null;
  }
}

async function cacheContent(
  url: string,
  content: ScrapedContent
): Promise<void> {
  try {
    const cacheKey = getCacheKey(url);
    content.cachedAt = Date.now();
    if (!isValidScrapedContent(content)) {
      return;
    }
    const serialized = JSON.stringify(content);

    if (serialized.length > MAX_CACHE_SIZE) {
      return;
    }
    await redis.set(cacheKey, serialized, { ex: CACHE_TTL });
  } catch (error) {}
}
