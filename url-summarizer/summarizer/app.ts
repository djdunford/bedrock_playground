import { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';
import { Metrics, MetricUnits } from '@aws-lambda-powertools/metrics';
import { Logger } from '@aws-lambda-powertools/logger';
import { Tracer } from '@aws-lambda-powertools/tracer';
import { load } from "cheerio";
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
const metrics = new Metrics();
const logger = new Logger();
const tracer = new Tracer();

const fetchWebPageText = async (url: string) => {
    try {
        const response = await fetch(url);
        const data = await response.text();
        const $ = load(data);
        const body = $('body');
        body.find('script, style').remove();
        return body.text().trim().split(' ').slice(0, 1000).join(' ');
    } catch (e) {
        console.error(e)
        return "";
    }
}

const buildPromptText = (text: string) => {
    return `"${text}"
        Summarize the above web page content in 5 bullet.
        Start each bullet point with a *
    `;
}

const bedrockClient = new BedrockRuntimeClient({region: "us-east-1"});

const bedrockQuery = async (promptText: string) => {
    const modelId = 'ai21.j2-ultra-v1';
    const requestBody = {
        prompt: promptText,
        maxTokens: 1024,
        temperature: 0.7,
        topP: 1,
        stopSequences: [],
        countPenalty: {scale: 0},
        presencePenalty: {scale: 0},
        frequencyPenalty: {scale: 0},
    };
    try {
        const params = {
            modelId: modelId,
            body: JSON.stringify(requestBody),
            accept: 'application/json',
            contentType: 'application/json',
        }

        const command = new InvokeModelCommand(params);
        const response = await bedrockClient.send(command);
        const buffer = Buffer.from(response.body);
        const text = buffer.toString();
        const responseData = JSON.parse(text);

        return responseData.completions[0].data.text;

    } catch (error) {
        console.error(`Error: ${error}`);
        return "";
    }
}

const parseResponse = (responseText: string) => {
    return responseText
      .trim()
      .split("*")
      .map((item: string) => item.trim())
      .filter((item: string) => !!item);
}

const summarizeWebPage = async (data: any): Promise<any> => {
    const text = await fetchWebPageText(data.url);
    const promptText = buildPromptText(text);
    const response = await bedrockQuery(promptText);

    return parseResponse(response);
}

export const lambdaHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
    const body = JSON.parse(event.body!);
    const result = await summarizeWebPage(body);
    return {
        statusCode: 200,
        body: JSON.stringify(result),
    }
}


// export const lambdaHandler = async (event: APIGatewayProxyEvent, context: Context): Promise<APIGatewayProxyResult> => {
//     let response: APIGatewayProxyResult;
//
//     // Log the incoming event
//     logger.info('Lambda invocation event', { event });
//
//     // Append awsRequestId to each log statement
//     logger.appendKeys({
//         awsRequestId: context.awsRequestId,
//     });
//     // Get facade segment created by AWS Lambda
//     const segment = tracer.getSegment();
//
//     if (!segment) {
//         response = {
//             statusCode: 500,
//             body: "Failed to get segment"
//         }
//         return response;
//     }
//
//     // Create subsegment for the function & set it as active
//     const handlerSegment = segment.addNewSubsegment(`## ${process.env._HANDLER}`);
//     tracer.setSegment(handlerSegment);
//
//     // Annotate the subsegment with the cold start & serviceName
//     tracer.annotateColdStart();
//     tracer.addServiceNameAnnotation();
//
//     // Add annotation for the awsRequestId
//     tracer.putAnnotation('awsRequestId', context.awsRequestId);
//     // Capture cold start metrics
//     metrics.captureColdStartMetric();
//     // Create another subsegment & set it as active
//     const subsegment = handlerSegment.addNewSubsegment('### MySubSegment');
//     tracer.setSegment(subsegment);
//
//     try {
//         // hello world code
//         response = {
//             statusCode: 200,
//             body: JSON.stringify({
//                 message: 'hello world',
//             }),
//         };
//         logger.info(`Successful response from API enpoint: ${event.path}`, response.body);
//     } catch (err) {
//         // Error handling
//         response = {
//             statusCode: 500,
//             body: JSON.stringify({
//                 message: 'some error happened',
//             }),
//         };
//         tracer.addErrorAsMetadata(err as Error);
//         logger.error(`Error response from API enpoint: ${err}`, response.body);
//     } finally {
//         // Close subsegments (the AWS Lambda one is closed automatically)
//         subsegment.close(); // (### MySubSegment)
//         handlerSegment.close(); // (## index.handler)
//
//         // Set the facade segment as active again (the one created by AWS Lambda)
//         tracer.setSegment(segment);
//         // Publish all stored metrics
//         metrics.publishStoredMetrics();
//     }
//
//     return response;
//
// };