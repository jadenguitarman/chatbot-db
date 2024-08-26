import { algoliasearch } from "algoliasearch";
import OpenAI from "openai";
import express from "express";
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const algoliaClient = algoliasearch(process.env.ALGOLIA_APPLICATION_ID, process.env.ALGOLIA_API_KEY);
const openai = new OpenAI(); // uses process.env.OPENAI_API_KEY automatically
const app = express(); // starts our server
app.use(express.json()); 

let messages = [
  {
    role: "system",
    content: "You're a helpful customer service agent named Emma. You're now connected with a customer in a chat window on the website of AllTheThings, an ecommerce company that sells a wide variety of household products. If you need information about the company that is generally available to a large group of customers or website visitors, the search_info function will let you search for that information. If you choose to use that information, recap it in your own words and in a human, conversational style, avoiding formatting. Before you give the user the answer, ask necessary followup questions to further narrow down the possible answers."
  }
];

const toolFunctions = {
  "searchAnnouncements": {
    definition: {
      type: "function",
      function: {
        name: "searchAnnouncements",
        description: "Search for general product and company information. Call this whenever you need to know about company news, deals going on right now, current trends, supply chain notices, and other information that generally affects all customers.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The query string with which to search the company announcements database"
            }
          },
          required: ["query"],
          additionalProperties: false
        }
      }
    },
    func: async ({query}) => {
      // must return a string to be used as a message back to the AI
      // we're not worrying about whether the user is authenticated because these are public announcements

      const { results } = await algoliaClient.search({
        requests: [
          {
            indexName: "announcements",
            query
          }
        ]
      });
      
      return JSON.stringify(results[0].hits.map(x => x.message));
    }
  },
  "searchOrders": {
    definition: {
      type: "function",
      function: {
        name: "searchOrders",
        description: "Search for specific order information.",
        parameters: {
          type: "object",
          properties: {
            orderID: {
              type: "string",
              description: "The ID of the order which will be used to pull up the order details"
            }
          },
          required: ["orderID"],
          additionalProperties: false
        }
      }
    },
    func: async ({orderID}) => {
      // must return a string to be used as a message back to the AI

      const user = await authenticateUser();
      const { results } = await algoliaClient.search({
        requests: [
          {
            indexName: "orders",
            query: "",
            filters: `customerId:"${user.customerID}" AND orderNumber:"${orderID}"`
          }
        ]
      });
      
      console.log(JSON.stringify(results[0].hits));

      if (results[0].hits.length == 0) return "That order number isn't valid.";

      return JSON.stringify({
        orderedOnDate: results[0].hits[0].date,
        shippingAddress: results[0].hits[0].address,
        totalWeightInPounds: results[0].hits[0].totalWeight,
        totalPrice: results[0].hits[0].total,
        deliveryDate: results[0].hits[0].deliveryDate
      });
    }
  }
};

const authenticateUser = async () => {
  return {
    customerID: "e8f9g0h1-2i3j-4k5l-6m7n-8o9p0q1r2s3t",
    name: "Jaden",
    image: "https://placehold.co/60x60?text=J"
  };
}

const getAIResponse = async () => {
	const response = await openai.chat.completions.create({
		model: "gpt-4o-mini",
		messages,
		tools: Object.values(toolFunctions).map(x => x.definition)
	});

  messages.push(response.choices[0].message);

  switch (response.choices[0].finish_reason ?? "stop") {
    case "length":
      console.error("The AI's response was too long.");
      return;

    case "content_filter":
      console.error("The AI's response violated their content policy.");
      return;

    case "tool_calls": // The AI is telling us to call a function
      // note that if you use the setting to force the ai to use a tool, the finish reason will actually be "stop", not "tool_calls". we're not using that functionality here so we don't need the extra logic.

      const requestedFunction = toolFunctions[response.choices[0].message.tool_calls[0].function.name]?.func;
      if (typeof requestedFunction === "undefined") {
        console.error("Somehow the AI tried to call a function that doesn't exist.");
        return;
      }

      messages.push({
        role: "tool",
        content: await requestedFunction(
          // the arguments the AI wants to pass to this function
          JSON.parse(response.choices[0].message.tool_calls[0].function.arguments)
        ),
        tool_call_id: response.choices[0].message.tool_calls[0].id
      });

      return await getAIResponse();

    case "stop": // The AI is just giving us a text response
      return response.choices[0].message.content;
  }
};

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/pages/index.html');
});

app.use(express.static('public'))

app.post("/send-chat-message", async (req, res) => {
  console.log(req.body)
  const { content } = req.body;

  if (!content) {
    res.json({
      response: ""
    });
    return;
  }

  messages.push({
    role: "user",
    content
  });

  res.json({
    response: await getAIResponse()
  });
});

app.post("/get-user-image", async (req, res) => {
  const user = await authenticateUser();
  res.json({
    imageURL: user.image
  });
})

app.listen(3000);
