import crypto from 'crypto';
import type { NextApiRequest, NextApiResponse } from 'next';

interface ShopifyWebhookBody {
  [key: string]: any;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    // Verify Shopify webhook
    const hmac = req.headers['x-shopify-hmac-sha256'] as string;
    const topic = req.headers['x-shopify-topic'] as string;
    const shop = req.headers['x-shopify-shop-domain'] as string;

    if (!hmac || !topic || !shop) {
      console.error('Missing required Shopify headers');
      return res.status(400).send('Missing required headers');
    }

    // Verify webhook authenticity
    const rawBody = await getRawBody(req);
    const verified = verifyWebhook(rawBody, hmac);

    if (!verified) {
      console.error('Webhook verification failed');
      return res.status(401).send('Webhook verification failed');
    }

    // Parse and log the webhook payload
    const webhookBody: ShopifyWebhookBody = JSON.parse(rawBody.toString());

    console.log('Received Shopify webhook:');
    console.log('Topic:', topic);
    console.log('Shop:', shop);
    console.log('Payload:', JSON.stringify(webhookBody, null, 2));

    // Handle the webhook (you can add specific logic here based on the topic)

    res.status(200).send('Webhook received and processed');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Internal Server Error');
  }
}

async function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      resolve(Buffer.from(body));
    });
    req.on('error', reject);
  });
}

function verifyWebhook(body: Buffer, hmac: string): boolean {
  const hash = crypto
    .createHmac('sha256', process.env.SHOPIFY_WEBHOOK_SECRET || '')
    .update(body)
    .digest('base64');
  return hash === hmac;
}
