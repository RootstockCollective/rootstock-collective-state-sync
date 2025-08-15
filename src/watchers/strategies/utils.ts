import { DatabaseContext } from "../../context/db";
import { BlockChangeLog } from "./types";

export const getLastProcessedBlock = async (
    db: DatabaseContext['db']
): Promise<BlockChangeLog> => {
    const result = await db<BlockChangeLog>('BlockChangeLog').orderBy('blockNumber', 'desc').first()

    return result ?? {
        id: '0x00',
        blockNumber: BigInt(0),
        blockTimestamp: BigInt(0),
        updatedEntities: []
    }
}
