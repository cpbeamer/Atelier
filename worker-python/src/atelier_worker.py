import asyncio
import os
from temporalio.client import Client
from temporalio.worker import Worker

async def main():
    address = os.environ.get('TEMPORAL_ADDRESS', '127.0.0.1:7466')
    namespace = os.environ.get('TEMPORAL_NAMESPACE', 'default')

    client = await Client.connect(address, namespace=namespace)

    worker = Worker(
        client,
        task_queue='atelier-default-py',
        workflows=[],
        activities=[],
    )

    print('Python Temporal Worker started on atelier-default-py')
    await worker.run()

if __name__ == '__main__':
    asyncio.run(main())
