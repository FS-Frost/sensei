// Los tests usan bases en memoria (openDb(':memory:')) y nunca llaman a Gemini de verdad.
process.env.GEMINI_API_KEY = '';
