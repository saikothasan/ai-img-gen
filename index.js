export default {
  async fetch(request, env) {
    try {
      // Allow all methods
      if (request.method !== 'GET' && request.method !== 'POST') {
        return new Response('Method not allowed', { status: 405 });
      }

      // Get the prompt from the URL parameters for GET method
      let prompt;
      if (request.method === 'GET') {
        const url = new URL(request.url);
        prompt = url.searchParams.get('prompt');
      } else if (request.method === 'POST') {
        // Parse the request payload for POST method
        const { prompt: postPrompt } = await request.json();
        prompt = postPrompt;
      }

      if (!prompt) {
        return new Response('Missing prompt in request body or URL', { status: 400 });
      }

      // Inputs for the AI model
      const inputs = {
        prompt: prompt,
      };

      // Generate image using AI
      const aiResponse = await env.AI.run(
        '@cf/stabilityai/stable-diffusion-xl-base-1.0',
        inputs
      );

      if (!aiResponse) {
        return new Response('Failed to generate image', { status: 500 });
      }

      // Create a unique key for the image in R2
      const imageKey = `images/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.png`;

      // Store the image in R2 with metadata including creation time
      const metadata = {
        createdAt: Date.now(),
      };

      await env.R2_BUCKET.put(imageKey, aiResponse, {
        httpMetadata: {
          contentType: 'image/png',
        },
        metadata: metadata, // Store the timestamp in metadata
      });

      // Construct the public URL for the image
      const imageUrl = `https://pub-afe4df44db4743d79958c54ec976929f.r2.dev/${imageKey}`;

      // Respond with the image URL
      return new Response(JSON.stringify({ imageUrl }), {
        headers: { 'content-type': 'application/json' },
      });
    } catch (error) {
      console.error('Error handling request:', error);
      return new Response('Internal server error', { status: 500 });
    }
  },

  // Cron job handler for auto-deleting images older than 7 days
  async scheduled(event, env) {
    const cutoffTime = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days ago

    let objects;
    let cursor = undefined;

    // Loop through all objects in the R2 bucket (pagination)
    do {
      objects = await env.R2_BUCKET.list({ cursor });

      for (const object of objects.objects) {
        // Fetch metadata of the object
        const metadata = object.metadata;
        if (metadata && metadata.createdAt && metadata.createdAt < cutoffTime) {
          // Delete object if it's older than 7 days
          console.log(`Deleting image: ${object.key}`);
          await env.R2_BUCKET.delete(object.key);
        }
      }

      cursor = objects.cursor; // Set the cursor for pagination
    } while (cursor); // Continue if there are more objects to fetch
  },
};
