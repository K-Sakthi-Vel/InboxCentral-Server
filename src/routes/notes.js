const express = require('express');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const router = express.Router();

// Get all notes for the user's team
router.get('/', async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { teamRoles: true } });

  if (!user || !user.teamRoles || user.teamRoles.length === 0) {
    return res.status(403).json({ error: 'User is not a member of any team.' });
  }
  const teamId = user.teamRoles[0].teamId;

  try {
    const notes = await prisma.note.findMany({
      where: {
        teamId,
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
    res.json(notes);
  } catch (error) {
    console.error('Error fetching notes:', error);
    res.status(500).json({ error: 'Failed to fetch notes' });
  }
});

// Create a new note
router.post('/', async (req, res) => {
  const { content, contactId } = req.body;
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: { teamRoles: true } });

  if (!user || !user.teamRoles || user.teamRoles.length === 0) {
    return res.status(403).json({ error: 'User is not a member of any team.' });
  }
  const teamId = user.teamRoles[0].teamId;
  const authorId = req.user.id;

  try {
    const note = await prisma.note.create({
      data: {
        teamId,
        authorId,
        content,
        ...(contactId && {
          contact: {
            connect: {
              id: contactId,
            },
          },
        }),
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    // Ensure io is available before attempting to emit
    if (req.app.get('io')) {
      const io = req.app.get('io');
      io.to(teamId).emit('note_added', note); // Emit 'note_added' for new notes
    } else {
      console.warn('Socket.IO instance not available on app object. Real-time updates may not work.');
    }

    res.status(201).json(note);
  } catch (error) {
    console.error('Error saving note:', error);
    res.status(500).json({ error: 'Failed to save note' });
  }
});

module.exports = router;
