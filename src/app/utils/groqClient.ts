import Groq from "groq-sdk"

const groq=new Groq({
    apiKey:process.env.GROQ_API_KEY,
})

interface ChatMessage{
    role: "system"|"user"|"assistant";
    content: string
}
export async function getGroqResponse(chatMessages: ChatMessage[]){
    const messages: ChatMessage[]=[
        {
            role: "system", 
            content: "You are an academic expert, you always cite your sources and base your responses only on the context that you have been provided. You carefully investigate every text you are given and remain as neutral as possible, only sticking to the details given in the context. If there is no website or content given, a citation is not necessary. You stay within the context of the articles most recently given unless specified"
        },
        ...chatMessages
    ]
    console.log("messages", messages)
    console.log("Starting groq api request");
    const response = await groq.chat.completions.create({
        model: "llama-3.1-8b-instant",messages
    })
    console.log("finished groq qpi request", response);
    return response.choices[0].message.content;
}
