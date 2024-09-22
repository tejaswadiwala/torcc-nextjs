import { Buffer } from 'buffer';
import crypto from 'crypto';
import { NextApiRequest, NextApiResponse } from 'next';

interface ShopifyWebhookBody {
  [key: string]: any;
}

export const config = {
  api: {
    bodyParser: false
  }
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  try {
    const hmac = req.headers['x-shopify-hmac-sha256'] as string;
    const topic = req.headers['x-shopify-topic'] as string;
    const shop = req.headers['x-shopify-shop-domain'] as string;

    console.log('Received headers:', JSON.stringify(req.headers, null, 2));

    if (!hmac || !topic || !shop) {
      console.error('Missing required Shopify headers');
      return res.status(400).send('Missing required headers');
    }

    const rawBody = await getRawBody(req);
    console.log('Raw body length:', rawBody.length);
    console.log('Raw body preview:', rawBody.toString().substring(0, 100) + '...');

    const verified = verifyWebhook(rawBody, hmac);

    if (!verified) {
      console.error('Webhook verification failed');
      console.error('HMAC from Shopify:', hmac);
      console.error('Calculated HMAC:', calculateHMAC(rawBody));
      return res.status(401).send('Webhook verification failed');
    }

    console.log('Webhook verified successfully');

    const webhookBody: ShopifyWebhookBody = JSON.parse(rawBody.toString());

    console.log('Received Shopify webhook:');
    console.log('Topic:', topic);
    console.log('Shop:', shop);
    console.log('Payload:', JSON.stringify(webhookBody, null, 2));

    await updateSalesDonatedMetaobject(webhookBody.current_total_price);

    res.status(200).send('Webhook received and processed');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Internal Server Error');
  }
}

async function updateSalesDonatedMetaobject(orderTotalPrice: string) {
  const getQuery = `query GetMetaobjectByHandle($id: ID!) {
    metaobject(id: $id) {
      handle
      type
      fields {
        key
        value
        type
      }
    }
  }`;

  const getVariables = {
    id: `gid://shopify/Metaobject/${process.env.SHOPIFY_METAOBJECT_SALES_DONATED_ID}`
  };

  const getResponse = await shopifyGraphQL(
    JSON.stringify({ query: getQuery, variables: getVariables })
  );

  const currentTotalPrice = parseInt(getResponse.data.metaobject.fields[0].value);
  const priceToUpdate = Math.floor(currentTotalPrice + parseInt(orderTotalPrice));

  const updateQuery = `mutation UpdateMetaobject($id: ID!, $metaobject: MetaobjectUpdateInput!) {
    metaobjectUpdate(id: $id, metaobject: $metaobject) {
      metaobject {
        handle
      }
      userErrors {
        field
        message
        code
      }
    }
  }`;

  const updateVariables = {
    id: `gid://shopify/Metaobject/${process.env.SHOPIFY_METAOBJECT_SALES_DONATED_ID}`,
    metaobject: {
      fields: [
        {
          key: 'sales_donated',
          value: `${priceToUpdate}`
        }
      ]
    }
  };

  const updateResponse = await shopifyGraphQL(
    JSON.stringify({ query: updateQuery, variables: updateVariables })
  );
}

async function getRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', reject);
  });
}

function calculateHMAC(body: Buffer): string {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    console.error('SHOPIFY_WEBHOOK_SECRET is not set');
    return '';
  }
  return crypto.createHmac('sha256', secret).update(body).digest('base64');
}

function verifyWebhook(body: Buffer, hmac: string): boolean {
  const calculatedHmac = calculateHMAC(body);
  if (!calculatedHmac) return false;
  return crypto.timingSafeEqual(Buffer.from(calculatedHmac), Buffer.from(hmac));
}

async function shopifyGraphQL(body: string): Promise<any> {
  const type = 'shopifyGraphQL';
  try {
    console.log({
      message: `${type}: Starting now.`,
      body
    });

    const endpoint = `https://${process.env.SHOPIFY_SHOP_NAME}.myshopify.com/admin/api/${process.env.SHOPIFY_API_VERSION}/graphql.json`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-Shopify-Access-Token': process.env.SHOPIFY_ACCESS_TOKEN as string,
        'Content-Type': 'application/json'
      },
      body: body
    });

    if (!response.ok) {
      throw new Error(
        `${type}: HTTP error! status: ${response.status}, message: ${JSON.stringify(response)}`
      );
    }

    const jsonResponse = await response.json();

    console.log({
      message: `${type}: Successfully completed execution.`,
      response: JSON.stringify(jsonResponse)
    });
    return jsonResponse;
  } catch (error) {
    console.error({
      message: `${type}: Error occurred.`,
      error: error
    });
    throw error;
  }
}
