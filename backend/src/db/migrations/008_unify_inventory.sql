-- Seeds and harvested crops are now the SAME item (you plant a carrot, you harvest carrots). Fold any existing
-- seed rows into the crop rows so nobody loses anything, then remove the seed rows.
INSERT INTO inventory (user_id, kind, crop_id, quantity)
  SELECT user_id, 'crop', crop_id, quantity FROM inventory WHERE kind = 'seed' AND quantity > 0
  ON CONFLICT (user_id, kind, crop_id) DO UPDATE SET quantity = quantity + excluded.quantity;
DELETE FROM inventory WHERE kind = 'seed';
