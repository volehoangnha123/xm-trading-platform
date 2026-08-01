import sql from 'mssql';
import { poolPromise } from '../config/db.js';
import { getPricesData } from './priceController.js';

const formatLocalDate = (dateVal) => {
    if (!dateVal) return null;
    let d;
    if (typeof dateVal === 'string') {
        const cleanStr = dateVal.endsWith('Z') || dateVal.includes('+') ? dateVal : `${dateVal.replace(' ', 'T')}Z`;
        d = new Date(cleanStr);
    } else {
        d = new Date(dateVal);
    }
    if (isNaN(d.getTime())) return dateVal;
    return d.toISOString();
};

export const placeOrder = async (req, res) => {
    try {
        const { symbol, betAmount, betType, duration } = req.body;
        const userId = req.user.id;

        if (!symbol || !betAmount || !betType) {
            return res.status(400).json({ success: false, message: 'Thiếu thông tin đặt cược.' });
        }

        if (betAmount <= 0) {
            return res.status(400).json({ success: false, message: 'Số tiền cược phải lớn hơn 0.' });
        }

        if (betType !== 'UP' && betType !== 'DOWN') {
            return res.status(400).json({ success: false, message: 'Loại cược không hợp lệ.' });
        }

        const validDurations = [60, 120, 180, 360];
        const seconds = validDurations.includes(Number(duration)) ? Number(duration) : 60;

        const pool = await poolPromise;
        if (!pool) return res.status(500).json({ success: false, message: 'Lỗi kết nối cơ sở dữ liệu' });

        // Get current price
        const pricesData = getPricesData();
        const currentCoin = pricesData[symbol];
        if (!currentCoin) {
            return res.status(400).json({ success: false, message: 'Đồng coin không tồn tại.' });
        }
        const startPrice = currentCoin.price;

        // Start transaction
        const transaction = new sql.Transaction(pool);
        await transaction.begin();

        try {
            // Check balance
            const userResult = await transaction.request()
                .input('UserId', sql.Int, userId)
                .query('SELECT Balance FROM Users WHERE Id = @UserId');

            if (userResult.recordset.length === 0) {
                await transaction.rollback();
                return res.status(404).json({ success: false, message: 'Không tìm thấy người dùng' });
            }

            const currentBalance = userResult.recordset[0].Balance;
            if (currentBalance < betAmount) {
                await transaction.rollback();
                return res.status(400).json({ success: false, message: 'Số dư không đủ để đặt cược.' });
            }

            // Deduct balance
            await transaction.request()
                .input('BetAmount', sql.Decimal(18, 2), betAmount)
                .input('UserId', sql.Int, userId)
                .query('UPDATE Users SET Balance = Balance - @BetAmount WHERE Id = @UserId');

            // Insert BinaryOrder (EndTime is seconds from StartTime)
            const insertResult = await transaction.request()
                .input('UserId', sql.Int, userId)
                .input('Symbol', sql.NVarChar(20), symbol)
                .input('BetAmount', sql.Decimal(18, 2), betAmount)
                .input('BetType', sql.NVarChar(10), betType)
                .input('StartPrice', sql.Decimal(18, 6), startPrice)
                .input('Duration', sql.Int, seconds)
                .query(`
                    INSERT INTO BinaryOrders (UserId, Symbol, BetAmount, BetType, StartPrice, EndTime, Duration)
                    OUTPUT INSERTED.Id, INSERTED.StartTime, INSERTED.EndTime, INSERTED.Duration
                    VALUES (@UserId, @Symbol, @BetAmount, @BetType, @StartPrice, DATEADD(second, @Duration, GETUTCDATE()), @Duration)
                `);

            await transaction.commit();

            const newOrder = insertResult.recordset[0];

            return res.status(200).json({
                success: true,
                message: 'Đặt cược thành công',
                order: {
                    id: newOrder.Id,
                    symbol,
                    betAmount,
                    betType,
                    startPrice,
                    startTime: formatLocalDate(newOrder.StartTime),
                    endTime: formatLocalDate(newOrder.EndTime),
                    status: 'PENDING'
                },
                serverTime: new Date().toISOString()
            });

        } catch (err) {
            await transaction.rollback();
            throw err;
        }

    } catch (err) {
        console.error('Error in placeOrder:', err);
        res.status(500).json({ success: false, message: 'Lỗi server khi đặt cược.' });
    }
};

export const getHistory = async (req, res) => {
    try {
        const userId = req.user.id;
        const pool = await poolPromise;
        if (!pool) return res.status(500).json({ success: false, message: 'Lỗi kết nối cơ sở dữ liệu' });

        const result = await pool.request()
            .input('UserId', sql.Int, userId)
            .query(`
                SELECT Id, Symbol, BetAmount, BetType, StartPrice, EndPrice, StartTime, EndTime, Duration, Status, Payout
                FROM BinaryOrders
                WHERE UserId = @UserId
                ORDER BY StartTime DESC
            `);

        const formattedOrders = result.recordset.map(order => ({
            ...order,
            StartTime: formatLocalDate(order.StartTime),
            EndTime: formatLocalDate(order.EndTime)
        }));

        res.status(200).json({ success: true, orders: formattedOrders, serverTime: new Date().toISOString() });
    } catch (err) {
        console.error('Error in getHistory:', err);
        res.status(500).json({ success: false, message: 'Lỗi server khi lấy lịch sử.' });
    }
};
