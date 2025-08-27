import requests

def get_current_weather(city: str):
    """Get the current weather in a given city using wttr.in API.

    Args:
        city: The name of the city to get the weather for.

    Returns:
        A dictionary containing the current weather information.
    """
    try:
        # Using the same API as your JavaScript example
        url = f"https://wttr.in/{city.lower()}?format=%C+%t"
        response = requests.get(url)
        
        if response.status_code == 200:
            # Get the weather data as text
            weather_data = response.text.strip()
            return {
                "city": city,
                "weather_description": weather_data
            }
        else:
            return {
                "city": city,
                "error": f"Failed to fetch weather data. Status: {response.status_code}"
            }
    except requests.RequestException as e:
        return {
            "city": city,
            "error": f"Network error: {str(e)}"
        }


# Define the function declaration for the weather tool.
get_current_weather_declaration = {
    "name": "get_current_weather",
    "description": "Get the current weather in a given city.",
    "parameters": {
        "type": "object",
        "properties": {
            "city": {
                "type": "string",
                "description": "The name of the city to get the weather for.",
            },
        },
        "required": ["city"],
    },
}
# Example usage
if __name__ == "__main__":
    result = get_current_weather("Jaipur")
    print(result)