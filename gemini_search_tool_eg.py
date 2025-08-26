from google import genai
from google.genai import types
import os
from dotenv import load_dotenv

load_dotenv()

# Configure the client with API key
client = genai.Client(api_key=os.getenv("GOOGLE_GENAI_API_KEY"))

# Define the function declaration for the weather tool
get_weather_declaration = types.FunctionDeclaration(
    name="get_current_weather",
    description="Get the current weather in a given city using a weather API.",
    parameters={
        "type": "object",
        "properties": {
            "city": {
                "type": "string",
                "description": "The name of the city to get the weather for (e.g., 'Jaipur', 'New York', 'London')."
            }
        },
        "required": ["city"]
    }
)

# Create separate tools (you can only use one type per tool)
google_search_tool = types.Tool(
    google_search=types.GoogleSearch()
)

weather_function_tool = types.Tool(
    function_declarations=[get_weather_declaration]
)

# Configuration for Google Search
search_config = types.GenerateContentConfig(
    tools=[google_search_tool],
    thinking_config=types.ThinkingConfig(thinking_budget=5000)
)

# Configuration for Function Calling
function_config = types.GenerateContentConfig(
    tools=[weather_function_tool],
    thinking_config=types.ThinkingConfig(thinking_budget=5000)
)

print("=== Example 1: OpenAI Question (Google Search) ===")
search_response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="When is open ai agent sdk launched. search in web",
    config=search_config,
)

print("🤖 Response with Google Search:")
print(search_response.candidates[0].content.parts[0].text)

print("\n" + "="*60 + "\n")

print("=== Example 2: Weather Question (Function Calling) ===")
from get_current_weather_tool import get_current_weather

weather_response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents="What's the current weather in Jaipur?",
    config=function_config,
)

# Check if the model wants to call a function
if hasattr(weather_response.candidates[0].content.parts[0], 'function_call') and weather_response.candidates[0].content.parts[0].function_call:
    function_call = weather_response.candidates[0].content.parts[0].function_call
    
    if function_call.name == "get_current_weather":
        city = function_call.args["city"]
        print(f"🔍 Calling weather API for: {city}")
        
        # Call your weather function
        weather_result = get_current_weather(city)
        print(f"📊 Weather data: {weather_result}")
        
        # Send the function result back to the model
        follow_up_response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                f"What's the current weather in {city}?",
                types.Content(
                    parts=[
                        types.Part.from_function_response(
                            name="get_current_weather",
                            response=weather_result
                        )
                    ]
                )
            ],
            config=function_config
        )
        
        print("🤖 Final response:")
        print(follow_up_response.candidates[0].content.parts[0].text)
    else:
        print("❌ Unknown function called")
else:
    print("🤖 Direct response:")
    print(weather_response.candidates[0].content.parts[0].text)

print("\n" + "="*60 + "\n")

print("=== Example 3: Smart Tool Selection ===")

def ask_question(question):
    """Automatically choose the right tool based on question content."""
    
    # Check if it's a weather question
    weather_keywords = ['weather', 'temperature', 'forecast', 'rain', 'sunny', 'cloudy']
    if any(keyword in question.lower() for keyword in weather_keywords):
        print("🌤️ Using Weather Function Tool")
        config = function_config
        tool_type = "function"
    else:
        print("🌐 Using Google Search Tool")
        config = search_config
        tool_type = "search"
    
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=question,
        config=config,
    )
    
    return response, tool_type

# Test different questions
questions = [
    "What's the weather like in London today?",
    "When was the iPhone first released?",
    "What's the current weather in New York?",
    "Who won the last World Cup?"
]

for i, question in enumerate(questions, 1):
    print(f"\n--- Question {i}: {question} ---")
    response, tool_type = ask_question(question)
    
    if tool_type == "function" and hasattr(response.candidates[0].content.parts[0], 'function_call') and response.candidates[0].content.parts[0].function_call:
        # Handle function call
        function_call = response.candidates[0].content.parts[0].function_call
        if function_call.name == "get_current_weather":
            city = function_call.args["city"]
            weather_result = get_current_weather(city)
            
            final_response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=[
                    question,
                    types.Content(
                        parts=[
                            types.Part.from_function_response(
                                name="get_current_weather",
                                response=weather_result
                            )
                        ]
                    )
                ],
                config=function_config
            )
            print(final_response.candidates[0].content.parts[0].text)
    else:
        # Direct response or search result
        print(response.candidates[0].content.parts[0].text)


