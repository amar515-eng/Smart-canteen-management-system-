
const express = require("express");
const cors = require("cors");
const mysql = require("mysql2/promise");

const app = express();

app.use(cors());
app.use(express.json());

const db = mysql.createPool({
  host: "localhost",
  user: "root",
  password: "",
  database: "canteen_db",
  waitForConnections: true,
  connectionLimit: 10
});

app.get("/", (req, res) => {
  res.json({ message: "Smart Canteen API is running" });
});

app.get("/api/foods", async (req, res) => {
  try {
    const [foods] = await db.query(
      "SELECT * FROM foods ORDER BY id"
    );
    res.json(foods);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.post("/api/orders", async (req, res) => {
  const { customer_name, items } = req.body;

  if (!customer_name || !customer_name.trim() ||
      !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({
      message: "Enter your name and select food"
    });
  }

  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    let total = 0;
    const orderItems = [];

    for (const item of items) {
      const quantity = Number(item.quantity);

      if (!Number.isInteger(quantity) || quantity < 1) {
        throw new Error("Invalid food quantity");
      }

      const [foods] = await connection.query(
        "SELECT * FROM foods WHERE id = ? FOR UPDATE",
        [item.food_id]
      );

      if (!foods.length) {
        throw new Error("Food item not found");
      }

      const food = foods[0];

      if (food.stock < quantity) {
        throw new Error(`Not enough stock for ${food.name}`);
      }

      total += Number(food.price) * quantity;
      orderItems.push({
        food_id: food.id,
        quantity,
        price: food.price
      });
    }

    const [result] = await connection.query(
      `INSERT INTO orders
       (customer_name, total_amount, status)
       VALUES (?, ?, 'Pending')`,
      [customer_name.trim(), total]
    );

    for (const item of orderItems) {
      await connection.query(
        `INSERT INTO order_items
         (order_id, food_id, quantity, price)
         VALUES (?, ?, ?, ?)`,
        [result.insertId, item.food_id,
          item.quantity, item.price]
      );

      await connection.query(
        "UPDATE foods SET stock = stock - ? WHERE id = ?",
        [item.quantity, item.food_id]
      );
    }

    await connection.commit();

    res.status(201).json({
      message: "Order placed successfully",
      order_id: result.insertId,
      queue_number: result.insertId,
      total_amount: total,
      status: "Pending"
    });
  } catch (err) {
    await connection.rollback();
    res.status(400).json({ message: err.message });
  } finally {
    connection.release();
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const [orders] = await db.query(
      "SELECT * FROM orders ORDER BY id DESC"
    );
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.patch("/api/orders/:id/status", async (req, res) => {
  const allowed = ["Pending", "Preparing", "Ready", "Completed"];
  const { status } = req.body;

  if (!allowed.includes(status)) {
    return res.status(400).json({
      message: "Invalid order status"
    });
  }

  try {
    const [result] = await db.query(
      "UPDATE orders SET status = ? WHERE id = ?",
      [status, req.params.id]
    );

    if (!result.affectedRows) {
      return res.status(404).json({
        message: "Order not found"
      });
    }

    res.json({ message: "Order status updated", status });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

app.listen(5004, () => {
  console.log("Canteen server running at http://localhost:5004");
});
