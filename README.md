# 🚀 Cipher Chat

Cipher is a **real-time full-stack chat application** featuring 1-on-1 messaging and WhatsApp-inspired group conversations. Built with modern web technologies for speed, scalability, and smooth UX.

---

## ✨ Features

### 💬 Core Chat

* Real-time messaging using Socket.IO
* 1-on-1 conversations
* Group chats with admin roles
* Message status: Sent, Delivered, Read
* Edit & delete messages (sender only)
* File sharing support
* Typing indicators
* Unread message counters
* Browser notifications

---

### 🔁 Replies

* Reply to any message
* Swipe-to-reply (mobile)
* Reply button (desktop)
* Preserved reply context

---

### 👥 Groups (WhatsApp-style)

* Create groups with multiple members
* Admin controls:

  * Rename group
  * Add/remove members
  * Promote/demote admins
* Members can leave groups
* Member count display
* Sender labels in messages

---

### 🧠 Smart Group Features

* Seen status only when **everyone has read**
* Message info (who has seen/not seen)
* @mention system
* Group typing indicators (shows who is typing)

---

### 🎨 UI/UX

* Clean and responsive design
* Sidebar with search & chats
* Message action menu
* Reply preview bar
* Interactive modals

---

## 🛠️ Tech Stack

**Frontend**

* HTML, CSS, JavaScript
* Responsive custom UI

**Backend**

* Node.js
* Express.js
* MongoDB + Mongoose
* Socket.IO

---

## 📁 Project Structure

```
backend/
  config/
  middleware/
  models/
  routes/
  uploads/
  server.js

frontend/
  index.html
  style.css
  script.js
```

---

## ⚙️ Setup Instructions

### 1. Clone the repository

```bash
git clone https://github.com/your-username/cipher-chat.git
cd cipher-chat
```

---

### 2. Install dependencies

```bash
cd backend
npm install
```

---

### 3. Environment Variables

Create a `.env` file inside `backend/`:

```env
PORT=5000
MONGO_URI=your_mongodb_connection_string
JWT_SECRET=your_secret_key
```

---

### 4. Run the server

```bash
npm start
```

---

### 5. Open frontend

Just open:

```
frontend/index.html
```

---

## 🌐 Deployment

You can deploy using:

* Backend → Render / Railway
* Database → MongoDB Atlas
* Frontend → Netlify / Vercel

---

## 📱 Install as App (PWA)

Cipher Chat can be installed like a mobile app:

* Open the website in Chrome
* Click **“Install App”** button
* Or use browser menu → *Add to Home Screen*

---

## 🔌 API Overview

### Auth

* POST `/api/auth/signup`
* POST `/api/auth/login`

### Users

* GET `/api/users/me`
* GET `/api/users/search?q=`

### Conversations

* GET `/api/conversations`
* POST `/api/conversations`
* POST `/api/conversations/group`

### Messages

* GET `/api/messages/:conversationId`
* POST `/api/messages`
* PATCH `/api/messages/:id`
* DELETE `/api/messages/:id`

---

## ⚡ Real-Time Events

* `message:send`
* `message:new`
* `message:status`
* `message:read`
* `message:typing`
* `presence:update`

---

## 🧠 Notes

* Group messages show **Seen** only when all users read them
* 1-on-1 chats use standard read receipts
* UI is optimized for both mobile and desktop

---

## 📌 Future Improvements

* Voice messages
* Video calling
* End-to-end encryption
* Mobile app version

---

## 👨‍💻 Author

Aditya Mishra
