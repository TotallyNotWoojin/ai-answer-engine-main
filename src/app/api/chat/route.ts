// TODO: Implement the chat API with Groq and web scraping with Cheerio and Puppeteer
// Refer to the Next.js Docs on how to read the Request body: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
// Refer to the Groq SDK here on how to use an LLM: https://www.npmjs.com/package/groq-sdk
// Refer to the Cheerio docs here on how to parse HTML: https://cheerio.js.org/docs/basics/loading
// Refer to Puppeteer docs here: https://pptr.dev/guides/what-is-puppeteer
import { NextResponse } from "next/server";
import { getGroqResponse } from "@/app/utils/groqClient";
import { scrapeUrl, urlPattern } from "@/app/utils/scraper";

export async function POST(req: Request) {
  try {
    const { message, messages } = await req.json();
    console.log("message received: ", message);
    console.log("messages: ", messages);
    const url = message.match(urlPattern);
    let scrapedContent = "";
    if (url) {
      console.log("Url found", url);
      const scraperResponse = await scrapeUrl(url);
      if (scraperResponse) {
        scrapedContent = scraperResponse.content;
      }
      console.log(scrapedContent);
    }
    const userQuery = message.replace(url ? url[0] : "", "").trim();
    const userPrompt = `
    Answer my question: "${userQuery}". 
    Do not repeat the question and take your time analyzing the given files to give
    the best possible answer. If there are no files given, do not worry and instead just address the prompt that 
    the user also gave too.

    Under no circumstances will you mention anything about content being missing or incomplete.
    Do not include that you are addressing the original prompt in your final response.

    Do not include your analysis in your final response. Instead, just write out the most fitting response
    based on the prompt you are given.

    Do not mention that there is no content attached if there is no content attached.

    If only the contents is given with no further instruction, generate a 3 paragraph summary of the contents.

    All responses in regard to an external link or content should be at least 3 paragraphs long.
    
    Based on the following content: 
    <content> 
      ${scrapedContent}
    </content>
    `;

    const llmMessages = [
      ...messages,
      {
        role: "user",
        content: userPrompt,
      },
    ];
    const response = await getGroqResponse(llmMessages);

    return NextResponse.json({ message: response });
  } catch (error) {
    return NextResponse.json({ message: "Error" });
  }
}
