import os
import json
from tavily import TavilyClient

def web_search(query: str, max_results: int = 5):
    """
    Performs a web search using the Tavily API and returns a summarized answer and search results.

    Args:
        query (str): The search query.
        max_results (int): The maximum number of results to include.

    Returns:
        str: A JSON string containing the summarized answer and a list of search results.
             Returns an error message if the API key is missing or the search fails.
    """
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return "Error: TAVILY_API_KEY environment variable not set."

    try:
        tavily_client = TavilyClient(api_key=api_key)

        # Use include_answer to get a summarized answer directly from the API
        response = tavily_client.search(
            query=query,
            search_depth="advanced",
            include_answer=True,
            max_results=max_results
        )

        # The response is a dictionary. We can return it as a JSON string
        # for the LLM to process. This gives it structured data.
        return json.dumps(response)

    except Exception as e:
        return f"An error occurred during the web search with Tavily: {str(e)}"

# Define the function declaration for the web search tool.
# The description is updated to reflect that it's good for getting direct answers.
web_search_declaration = {
    "name": "web_search",
    "description": "Searches the web to answer questions about current events, facts, or general knowledge. Returns a direct answer and supporting sources.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": "The search query or topic to look up to get a direct answer.",
            },
        },
        "required": ["query"],
    },
}

# Example usage for testing
if __name__ == "__main__":
    # Make sure to set the TAVILY_API_KEY in your environment variables
    # For example: export TAVILY_API_KEY="your_key_here"

    api_key_set = os.getenv("TAVILY_API_KEY")
    if not api_key_set:
        print("TAVILY_API_KEY is not set. Please set it to run the test.")
    else:
        print("Tavily API key found. Running tests...")
        search_query = "What were the key findings of the latest IPCC report on climate change?"
        search_results = web_search(search_query)
        print("\n--- Test Case 1: Detailed Query ---")
        print(search_results)

        search_query_2 = "who won the eurovision song contest 2024"
        search_results_2 = web_search(search_query_2)
        print("\n--- Test Case 2: Simple Fact ---")
        print(search_results_2)
