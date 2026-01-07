const { getDb } = require('../config/db');

const exercises = [
  // CHEST
  { name: "Barbell Bench Press", category: "Chest", muscleGroup: "Chest", equipment: "Barbell", difficulty: "Intermediate", instructions: ["Lie on bench", "Grip barbell slightly wider than shoulders", "Lower to chest", "Press up explosively"] },
  { name: "Incline Dumbbell Press", category: "Chest", muscleGroup: "Chest", equipment: "Dumbbell", difficulty: "Intermediate", instructions: ["Set bench to 30-45 degree incline", "Press dumbbells up", "Lower with control"] },
  { name: "Push-Ups", category: "Chest", muscleGroup: "Chest", equipment: "Bodyweight", difficulty: "Beginner", instructions: ["Hands shoulder-width apart", "Lower body to ground", "Push back up"] },
  { name: "Cable Chest Fly", category: "Chest", muscleGroup: "Chest", equipment: "Cable", difficulty: "Intermediate", instructions: ["Set cables at chest height", "Bring handles together", "Control the return"] },
  { name: "Dips", category: "Chest", muscleGroup: "Chest", equipment: "Bodyweight", difficulty: "Intermediate", instructions: ["Lean forward slightly", "Lower body", "Press back up"] },

  // SHOULDERS
  { name: "Overhead Press", category: "Shoulders", muscleGroup: "Shoulders", equipment: "Barbell", difficulty: "Intermediate", instructions: ["Stand with barbell at shoulders", "Press overhead", "Lower with control"] },
  { name: "Dumbbell Shoulder Press", category: "Shoulders", muscleGroup: "Shoulders", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Press dumbbells overhead", "Lower to shoulders"] },
  { name: "Lateral Raises", category: "Shoulders", muscleGroup: "Shoulders", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Raise arms to sides", "Stop at shoulder height", "Lower slowly"] },
  { name: "Front Raises", category: "Shoulders", muscleGroup: "Shoulders", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Raise dumbbells to front", "Stop at shoulder height"] },
  { name: "Face Pulls", category: "Shoulders", muscleGroup: "Shoulders", equipment: "Cable", difficulty: "Beginner", instructions: ["Pull rope to face", "Flare elbows out", "Squeeze shoulder blades"] },

  // BACK - LATS
  { name: "Pull-Ups", category: "Lats", muscleGroup: "Back", equipment: "Bodyweight", difficulty: "Intermediate", instructions: ["Hang from bar", "Pull chin over bar", "Lower with control"] },
  { name: "Lat Pulldown", category: "Lats", muscleGroup: "Back", equipment: "Cable", difficulty: "Beginner", instructions: ["Pull bar to upper chest", "Squeeze lats", "Control the return"] },
  { name: "Barbell Row", category: "Lats", muscleGroup: "Back", equipment: "Barbell", difficulty: "Intermediate", instructions: ["Bent over position", "Pull bar to lower chest", "Lower with control"] },
  { name: "Dumbbell Row", category: "Lats", muscleGroup: "Back", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Support on bench", "Pull dumbbell to hip", "Lower slowly"] },

  // BACK - MIDDLE BACK
  { name: "Seated Cable Row", category: "Middle Back", muscleGroup: "Back", equipment: "Cable", difficulty: "Beginner", instructions: ["Pull handle to torso", "Squeeze shoulder blades", "Extend arms"] },
  { name: "T-Bar Row", category: "Middle Back", muscleGroup: "Back", equipment: "Barbell", difficulty: "Intermediate", instructions: ["Bent over position", "Pull bar to chest", "Lower with control"] },
  { name: "Chest Supported Row", category: "Middle Back", muscleGroup: "Back", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Lie on incline bench", "Row dumbbells up", "Squeeze at top"] },

  // BACK - LOWER BACK
  { name: "Deadlift", category: "Lower Back", muscleGroup: "Back", equipment: "Barbell", difficulty: "Advanced", instructions: ["Hip-width stance", "Grip bar", "Lift by extending hips and knees", "Lower with control"] },
  { name: "Romanian Deadlift", category: "Lower Back", muscleGroup: "Back", equipment: "Barbell", difficulty: "Intermediate", instructions: ["Start standing", "Hinge at hips", "Lower bar to shins", "Return to standing"] },
  { name: "Back Extensions", category: "Lower Back", muscleGroup: "Back", equipment: "Bodyweight", difficulty: "Beginner", instructions: ["Position on hyperextension bench", "Lower torso", "Extend back up"] },

  // TRAPS
  { name: "Barbell Shrugs", category: "Traps", muscleGroup: "Traps", equipment: "Barbell", difficulty: "Beginner", instructions: ["Hold barbell", "Shrug shoulders up", "Lower slowly"] },
  { name: "Dumbbell Shrugs", category: "Traps", muscleGroup: "Traps", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Hold dumbbells at sides", "Shrug up", "Lower with control"] },

  // BICEPS
  { name: "Barbell Curl", category: "Biceps", muscleGroup: "Arms", equipment: "Barbell", difficulty: "Beginner", instructions: ["Stand with barbell", "Curl up keeping elbows still", "Lower slowly"] },
  { name: "Dumbbell Curl", category: "Biceps", muscleGroup: "Arms", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Curl dumbbells up", "Rotate palms up", "Lower slowly"] },
  { name: "Hammer Curl", category: "Biceps", muscleGroup: "Arms", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Palms facing each other", "Curl up", "Lower with control"] },
  { name: "Cable Curl", category: "Biceps", muscleGroup: "Arms", equipment: "Cable", difficulty: "Beginner", instructions: ["Attach straight bar", "Curl up", "Keep elbows stable"] },
  { name: "Preacher Curl", category: "Biceps", muscleGroup: "Arms", equipment: "Barbell", difficulty: "Intermediate", instructions: ["Rest arms on preacher bench", "Curl bar up", "Lower slowly"] },

  // TRICEPS
  { name: "Tricep Dips", category: "Triceps", muscleGroup: "Arms", equipment: "Bodyweight", difficulty: "Intermediate", instructions: ["Keep body upright", "Lower down", "Press back up"] },
  { name: "Overhead Tricep Extension", category: "Triceps", muscleGroup: "Arms", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Hold dumbbell overhead", "Lower behind head", "Extend back up"] },
  { name: "Tricep Pushdown", category: "Triceps", muscleGroup: "Arms", equipment: "Cable", difficulty: "Beginner", instructions: ["Push cable down", "Keep elbows still", "Control the return"] },
  { name: "Close-Grip Bench Press", category: "Triceps", muscleGroup: "Arms", equipment: "Barbell", difficulty: "Intermediate", instructions: ["Narrow grip on bar", "Lower to chest", "Press up"] },
  { name: "Skull Crushers", category: "Triceps", muscleGroup: "Arms", equipment: "Barbell", difficulty: "Intermediate", instructions: ["Lie on bench", "Lower bar to forehead", "Extend arms"] },

  // FOREARMS
  { name: "Wrist Curls", category: "Forearms", muscleGroup: "Arms", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Rest forearms on bench", "Curl wrists up", "Lower slowly"] },
  { name: "Reverse Wrist Curls", category: "Forearms", muscleGroup: "Arms", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Palms down", "Curl wrists up", "Lower with control"] },
  { name: "Farmer's Walk", category: "Forearms", muscleGroup: "Arms", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Hold heavy dumbbells", "Walk for distance", "Maintain grip"] },

  // QUADRICEPS
  { name: "Barbell Squat", category: "Quadriceps", muscleGroup: "Legs", equipment: "Barbell", difficulty: "Intermediate", instructions: ["Bar on upper back", "Squat down", "Drive through heels"] },
  { name: "Front Squat", category: "Quadriceps", muscleGroup: "Legs", equipment: "Barbell", difficulty: "Advanced", instructions: ["Bar on front shoulders", "Squat down", "Keep torso upright"] },
  { name: "Leg Press", category: "Quadriceps", muscleGroup: "Legs", equipment: "Machine", difficulty: "Beginner", instructions: ["Place feet on platform", "Lower weight", "Press back up"] },
  { name: "Leg Extension", category: "Quadriceps", muscleGroup: "Legs", equipment: "Machine", difficulty: "Beginner", instructions: ["Extend legs", "Squeeze quads", "Lower slowly"] },
  { name: "Lunges", category: "Quadriceps", muscleGroup: "Legs", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Step forward", "Lower back knee", "Push back up"] },
  { name: "Bulgarian Split Squat", category: "Quadriceps", muscleGroup: "Legs", equipment: "Dumbbell", difficulty: "Intermediate", instructions: ["Rear foot elevated", "Squat down", "Drive up"] },

  // HAMSTRINGS
  { name: "Leg Curl", category: "Hamstrings", muscleGroup: "Legs", equipment: "Machine", difficulty: "Beginner", instructions: ["Curl legs up", "Squeeze hamstrings", "Lower slowly"] },
  { name: "Stiff-Leg Deadlift", category: "Hamstrings", muscleGroup: "Legs", equipment: "Barbell", difficulty: "Intermediate", instructions: ["Slight knee bend", "Hinge at hips", "Feel hamstring stretch"] },
  { name: "Nordic Curls", category: "Hamstrings", muscleGroup: "Legs", equipment: "Bodyweight", difficulty: "Advanced", instructions: ["Kneel with feet anchored", "Lower torso forward", "Use hamstrings to control"] },

  // GLUTES
  { name: "Hip Thrust", category: "Glutes", muscleGroup: "Legs", equipment: "Barbell", difficulty: "Intermediate", instructions: ["Back on bench", "Thrust hips up", "Squeeze glutes at top"] },
  { name: "Glute Bridge", category: "Glutes", muscleGroup: "Legs", equipment: "Bodyweight", difficulty: "Beginner", instructions: ["Lie on back", "Thrust hips up", "Squeeze glutes"] },
  { name: "Cable Kickback", category: "Glutes", muscleGroup: "Legs", equipment: "Cable", difficulty: "Beginner", instructions: ["Attach ankle cuff", "Kick leg back", "Squeeze glute"] },

  // CALVES
  { name: "Standing Calf Raise", category: "Calves", muscleGroup: "Legs", equipment: "Machine", difficulty: "Beginner", instructions: ["Stand on platform", "Raise up on toes", "Lower slowly"] },
  { name: "Seated Calf Raise", category: "Calves", muscleGroup: "Legs", equipment: "Machine", difficulty: "Beginner", instructions: ["Sit with weight on knees", "Raise heels", "Lower with control"] },
  { name: "Jump Rope", category: "Calves", muscleGroup: "Legs", equipment: "Jump Rope", difficulty: "Beginner", instructions: ["Jump continuously", "Land on balls of feet", "Keep rhythm"] },

  // ABDOMINALS
  { name: "Plank", category: "Abdominals", muscleGroup: "Core", equipment: "Bodyweight", difficulty: "Beginner", instructions: ["Forearms on ground", "Body straight", "Hold position"] },
  { name: "Crunches", category: "Abdominals", muscleGroup: "Core", equipment: "Bodyweight", difficulty: "Beginner", instructions: ["Lie on back", "Curl shoulders up", "Lower slowly"] },
  { name: "Hanging Leg Raises", category: "Abdominals", muscleGroup: "Core", equipment: "Bodyweight", difficulty: "Intermediate", instructions: ["Hang from bar", "Raise legs", "Lower with control"] },
  { name: "Russian Twists", category: "Abdominals", muscleGroup: "Core", equipment: "Dumbbell", difficulty: "Beginner", instructions: ["Sit with torso back", "Twist side to side", "Control movement"] },
  { name: "Bicycle Crunches", category: "Abdominals", muscleGroup: "Core", equipment: "Bodyweight", difficulty: "Beginner", instructions: ["Lie on back", "Alternate elbow to knee", "Keep moving"] },
  { name: "Ab Wheel Rollout", category: "Abdominals", muscleGroup: "Core", equipment: "Ab Wheel", difficulty: "Advanced", instructions: ["Roll wheel forward", "Extend fully", "Pull back"] },
  { name: "Cable Crunch", category: "Abdominals", muscleGroup: "Core", equipment: "Cable", difficulty: "Intermediate", instructions: ["Kneel facing cable", "Crunch down", "Control return"] }
];

async function seedExercises() {
  try {
    const db = getDb();
    
    // Check if exercises already exist
    const count = await db.collection('exercises').countDocuments();
    if (count > 0) {
      console.log(`⚠️  Exercises collection already has ${count} documents. Skipping seed.`);
      return;
    }

    // Insert exercises
    const result = await db.collection('exercises').insertMany(exercises);
    console.log(`✅ Successfully seeded ${result.insertedCount} exercises`);
    
    // Create indexes
    await db.collection('exercises').createIndex({ category: 1 });
    await db.collection('exercises').createIndex({ name: 'text' });
    console.log('✅ Created indexes on exercises collection');
    
  } catch (error) {
    console.error('❌ Error seeding exercises:', error);
    throw error;
  }
}

module.exports = { seedExercises, exercises };
