from playwright.sync_api import sync_playwright, expect

def run(playwright):
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context()
    page = context.new_page()

    try:
        page.goto("http://localhost:8000")

        # Click the record button
        record_button = page.locator("#record-button")
        record_button.click()

        # Wait for a few seconds to simulate speaking
        page.wait_for_timeout(3000)

        # Click the stop button
        record_button.click()

        # Wait for the transcript to appear
        transcript_container = page.locator("#transcript-container")
        expect(transcript_container).to_contain_text("hello", timeout=10000)

        # Take a screenshot
        page.screenshot(path="jules-scratch/verification/verification.png")

    finally:
        browser.close()

with sync_playwright() as playwright:
    run(playwright)
